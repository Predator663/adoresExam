"""A student's results: the list (with search, subject filter and sort), the summary on top of it, and the extras on one result
(how the questions went, the previous exam in the subject, how she compares with the class). Only results she may already see."""
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.permissions import IsStudent
from core.models import SchoolSettings
from core.pagination import paginate

from . import services
from .models import Result


def _answered(v):
    if v is None or v == "" or v == [] or v == {}:
        return False
    if isinstance(v, dict):
        return any(str(x if x is not None else "").strip() for x in v.values())
    return True


def breakdown(rows):
    """How the questions went: full marks, part marks, wrong, not answered, removed. Same rule as the review screens."""
    out = {"full": 0, "part": 0, "none": 0, "skip": 0, "void": 0}
    for q in rows:
        if q["voided"]:
            out["void"] += 1
            continue
        got = q["marks_awarded"] or 0
        if got >= q["marks"] - 1e-9:
            out["full"] += 1
        elif got > 0:
            out["part"] += 1
        elif q["skipped"] or q["timed_out"] or not _answered(q["your_response"]):
            out["skip"] += 1
        else:
            out["none"] += 1
    return out


def visible(user, now=None):
    now = now or timezone.now()
    rs = Result.objects.filter(student=user).select_related("attempt__exam__subject")
    return [r for r in rs if services.result_visible(r.attempt, now)]


def extras(attempt, result, rows, now=None):
    """Added to the result payload."""
    now = now or timezone.now()
    out = {"breakdown": breakdown(rows), "duration_minutes": attempt.exam.duration_minutes, "previous": None}
    earlier = (Result.objects.filter(student=attempt.student, exam__subject=attempt.exam.subject, exam__start_at__lt=attempt.exam.start_at)
               .select_related("attempt__exam").order_by("-exam__start_at")[:6])
    for r in earlier:
        if services.result_visible(r.attempt, now):
            out["previous"] = {"attempt_id": r.attempt_id, "exam": r.exam.title, "percent": r.percent, "delta": round(result.percent - r.percent, 1)}
            break
    if SchoolSettings.load().show_class_position:  # the same switch as the class position: it says where she stands
        others = Result.objects.filter(exam=attempt.exam).exclude(pk=result.pk)
        n = others.count()
        if n >= 4:
            out["beat_percent"] = round(100 * others.filter(percent__lt=result.percent).count() / n)
    return out


@api_view(["GET"])
@permission_classes([IsStudent])
def my_results(request):
    """?subject=<name>  ?q=<part of the exam title>  ?sort=best (default: newest first)"""
    rows = []
    subject, q, sort = request.query_params.get("subject", ""), request.query_params.get("q", "").strip().lower(), request.query_params.get("sort", "")
    for r in visible(request.user):
        if subject and r.exam.subject.name != subject:
            continue
        if q and q not in r.exam.title.lower():
            continue
        rows.append({"attempt_id": r.attempt_id, "exam": r.exam.title, "subject": r.exam.subject.name, "score": r.score, "total": r.total,
                     "percent": r.percent, "grade": r.grade, "passed": r.passed, "date": r.exam.start_at,
                     "updated": r.revision > 0, "previous_percent": (r.previous or {}).get("percent") if r.revision else None})
    rows.sort(key=(lambda x: (-x["percent"], x["date"])) if sort == "best" else (lambda x: x["date"]), reverse=sort != "best")
    return Response(paginate(request, rows) or rows)


@api_view(["GET"])
@permission_classes([IsStudent])
def my_results_summary(request):
    """The numbers on top of the results list: how many, the average, her best, the trend, and each subject."""
    rs = sorted(visible(request.user), key=lambda r: r.exam.start_at)
    if not rs:
        return Response({"count": 0, "average": 0, "passed": 0, "best": None, "trend": [], "subjects": [], "improving": 0})
    best = max(rs, key=lambda r: r.percent)
    subjects = {}
    for r in rs:
        subjects.setdefault(r.exam.subject.name, []).append(r)
    improving = 0  # exams in a row, counting back from the newest, that were better than the one before
    for a, b in zip(reversed(rs[1:]), reversed(rs[:-1])):
        if a.percent > b.percent:
            improving += 1
        else:
            break
    return Response({
        "count": len(rs), "average": round(sum(r.percent for r in rs) / len(rs), 1), "passed": sum(1 for r in rs if r.passed),
        "best": {"attempt_id": best.attempt_id, "exam": best.exam.title, "subject": best.exam.subject.name, "percent": best.percent},
        "trend": [r.percent for r in rs[-12:]], "improving": improving,
        "subjects": [{"subject": name, "count": len(v), "average": round(sum(x.percent for x in v) / len(v), 1), "last": v[-1].percent,
                      "delta": round(v[-1].percent - v[-2].percent, 1) if len(v) > 1 else None} for name, v in sorted(subjects.items())],
    })
