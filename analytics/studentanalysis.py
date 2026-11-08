"""Download results page: search one student and see a detailed analysis of her results (administrators).

For every published exam she wrote: how many questions she got right out of how many (for example 17 of 21), how many were partly right,
wrong or left unanswered, her marks, grade and time, how the exam went for everybody else, a line for every question, and her topics.
Voided questions (EXM-08) count for nobody, so they are not in the "out of".

  GET /api/exports/results-report/students/?q=amina          who matches (two letters at least), same term / subject / exam filters
  GET /api/exports/results-report/students/<id>/             her analysis, same term / subject / exam filters
"""
import html
import re
from collections import defaultdict

from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdminRole
from exams.models import Result

from .views import _full_name, _int_param, visible_results

MIN_SEARCH, MAX_MATCHES = 2, 15
EPS = 1e-9


def _has_response(r):
    """Did she actually answer? An empty box, an empty list or a skipped question is not an answer."""
    if r is None:
        return False
    if isinstance(r, str):
        return bool(r.strip())
    if isinstance(r, (list, tuple)):
        return any(_has_response(x) for x in r)
    if isinstance(r, dict):
        return any(_has_response(v) for v in r.values())
    return True


def question_status(awarded, marks, answered):
    """correct = full marks, partly = some marks, wrong = answered but no marks (or negative marking), unanswered = no answer."""
    if not answered:
        return "unanswered"
    if awarded >= marks - EPS:
        return "correct"
    if awarded > EPS:
        return "partly"
    return "wrong"


def _plain(text, limit=140):
    s = html.unescape(re.sub(r"<[^>]*>", " ", str(text or "")))
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[:limit - 1].rstrip() + "…"


def _exam_block(res):
    """One published exam of hers. `res` is a Result with exam, attempt and exam questions reachable."""
    attempt, exam = res.attempt, res.exam
    answers = {a.exam_question_id: a for a in attempt.answers.all()}
    counts = {"correct": 0, "partly": 0, "wrong": 0, "unanswered": 0}
    items, voided = [], 0
    for eq in exam.questions.all():
        if eq.voided:
            voided += 1
            continue
        p = eq.payload
        a = answers.get(eq.pk)
        answered = bool(a and not a.skipped and _has_response(a.response))
        awarded = float(a.marks_awarded) if a and a.marks_awarded is not None else 0.0
        status = question_status(awarded, p["marks"], answered)
        counts[status] += 1
        items.append({"number": eq.position, "type": p.get("qtype", ""), "topic": p.get("topic") or "General", "prompt": _plain(p.get("prompt")),
                      "marks": p["marks"], "awarded": round(awarded, 2), "status": status})
    avg = Result.objects.filter(exam=exam).aggregate(a=Avg("percent"), n=Count("pk"))
    topics = [{"topic": t, "earned": v[0], "possible": v[1], "percent": round(v[0] / v[1] * 100, 1) if v[1] else None}
              for t, v in sorted((res.topic_stats or {}).items())]
    return {
        "result_id": res.pk, "exam_id": exam.pk, "title": exam.title, "subject": exam.subject.name, "date": exam.start_at,
        "attempt_no": attempt.attempt_no, "score": res.score, "total": res.total, "percent": res.percent, "grade": res.grade,
        "points": res.points, "passed": res.passed, "time_taken_seconds": res.time_taken_seconds,
        "questions": {"total": len(items), "voided": voided, **counts},
        "exam_average": round(avg["a"], 1) if avg["a"] is not None else None, "exam_results": avg["n"],
        "topics": topics, "items": items,
    }


def _filtered(request, student_id):
    qs = visible_results(request.user).filter(student_id=student_id)
    for param, lookup in (("term", "exam__term_id"), ("subject", "exam__subject_id"), ("exam", "exam_id")):
        v = _int_param(request, param)
        if v is not None:
            qs = qs.filter(**{lookup: v})
    return qs.prefetch_related("attempt__answers", "exam__questions").order_by("exam__start_at", "exam_id", "attempt__attempt_no")


@api_view(["GET"])
@permission_classes([IsAdminRole])
def student_search(request):
    q = (request.query_params.get("q") or "").strip()
    if len(q) < MIN_SEARCH:
        return Response({"results": [], "min_letters": MIN_SEARCH})
    people = User.objects.filter(role=User.Role.STUDENT).select_related("school_class")
    for word in q.split():  # every word must match: "amina k" finds Amina Kimaro
        people = people.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(username__icontains=word) | Q(index_number__icontains=word))
    people = list(people.order_by("last_name", "first_name", "username")[:MAX_MATCHES])
    have = {}
    if people:
        mine = visible_results(request.user).filter(student_id__in=[u.pk for u in people])
        for param, lookup in (("term", "exam__term_id"), ("subject", "exam__subject_id"), ("exam", "exam_id")):
            v = _int_param(request, param)
            if v is not None:
                mine = mine.filter(**{lookup: v})
        have = dict(mine.values_list("student_id").annotate(n=Count("pk")))
    return Response({"results": [
        {"id": u.pk, "name": _full_name(u), "index": u.index_number, "username": u.username, "class": str(u.school_class) if u.school_class_id else "",
         "archived": u.is_archived, "graduated": u.graduated, "results": have.get(u.pk, 0)} for u in people]})


@api_view(["GET"])
@permission_classes([IsAdminRole])
def student_analysis(request, student_id):
    u = get_object_or_404(User.objects.select_related("school_class"), pk=student_id, role=User.Role.STUDENT)
    exams = [_exam_block(r) for r in _filtered(request, u.pk)]

    sums = {"correct": 0, "partly": 0, "wrong": 0, "unanswered": 0}
    questions = voided = 0
    by_subject, by_topic = defaultdict(lambda: {"exams": 0, "questions": 0, "correct": 0, "percents": [], "earned": 0.0, "possible": 0.0}), defaultdict(lambda: [0.0, 0.0])
    for e in exams:
        q = e["questions"]
        questions += q["total"]
        voided += q["voided"]
        for k in sums:
            sums[k] += q[k]
        s = by_subject[e["subject"]]
        s["exams"] += 1
        s["questions"] += q["total"]
        s["correct"] += q["correct"]
        s["percents"].append(e["percent"])
        s["earned"] += e["score"]
        s["possible"] += e["total"]
        for t in e["topics"]:
            by_topic[t["topic"]][0] += t["earned"]
            by_topic[t["topic"]][1] += t["possible"]
    percents = [e["percent"] for e in exams]
    topics = sorted(({"topic": t, "earned": round(v[0], 2), "possible": round(v[1], 2), "percent": round(v[0] / v[1] * 100, 1)} for t, v in by_topic.items() if v[1]),
                    key=lambda x: (x["percent"], x["topic"]))
    return Response({
        "student": {"id": u.pk, "name": _full_name(u), "index": u.index_number, "username": u.username,
                    "class": str(u.school_class) if u.school_class_id else "", "archived": u.is_archived, "graduated": u.graduated},
        "summary": {"exams": len(exams), "questions": questions, "voided": voided, **sums,
                    "average": round(sum(percents) / len(percents), 1) if percents else None,
                    "best": max(percents) if percents else None, "lowest": min(percents) if percents else None,
                    "marks": round(sum(e["score"] for e in exams), 2), "marks_possible": round(sum(e["total"] for e in exams), 2),
                    "passed": sum(1 for e in exams if e["passed"])},
        "subjects": [{"subject": k, "exams": v["exams"], "questions": v["questions"], "correct": v["correct"],
                      "average": round(sum(v["percents"]) / len(v["percents"]), 1), "marks": round(v["earned"], 2), "possible": round(v["possible"], 2)}
                     for k, v in sorted(by_subject.items())],
        "topics": topics, "exams": exams,
    })
