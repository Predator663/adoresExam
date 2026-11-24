"""Reads what students really answered, runs questions/calibration.py, and stores the measured difficulty on each Question.

Sources (a student's FIRST answer to a question counts, so learning from a retake or a second practice does not make it look easy):
  1. Published exams: the first attempt, marks awarded / marks, for questions that came from the question bank and were not voided.
  2. Practice quizzes: the fraction marked right.
Exams win when a student has both. Nothing here changes a mark, a result or a teacher's own difficulty setting.
"""
from collections import Counter, defaultdict

from django.db.models.fields.json import KeyTransform
from django.utils import timezone

from accounts.models import User
from exams.models import Answer, Attempt, Exam
from gamification.models import PracticeSession
from . import calibration as cal
from .models import Question

MIN_SUBJECT_RESPONSES, MIN_SUBJECT_STUDENTS = 100, 15


def collect():
    """{subject_id: {(student_id, question_id): fraction}}"""
    out = defaultdict(dict)
    students = set(User.objects.filter(role="student").values_list("pk", flat=True))
    rows = (Answer.objects.filter(attempt__exam__status=Exam.PUBLISHED, attempt__attempt_no=1,
                                  attempt__status__in=[Attempt.SUBMITTED, Attempt.AUTO_SUBMITTED],
                                  exam_question__source__isnull=False, exam_question__voided=False)
            .annotate(m=KeyTransform("marks", "exam_question__payload"))
            .values_list("attempt__student_id", "exam_question__source_id", "exam_question__source__subject_id", "marks_awarded", "m"))
    for sid, qid, subj, awarded, marks in rows.iterator():
        try:
            m = float(marks)
        except (TypeError, ValueError):
            continue
        if sid in students and m > 0:  # no marks awarded = she got nothing (skipped or wrong)
            out[subj].setdefault((sid, qid), max(0.0, min(1.0, float(awarded or 0.0) / m)))
    for sid, subj, answers in PracticeSession.objects.filter(user__in=students).exclude(answers=[]).values_list("user_id", "subject_id", "answers").iterator():
        for a in answers:
            out[subj].setdefault((sid, a["qid"]), max(0.0, min(1.0, float(a.get("fraction", 0.0)))))
    return out


def _row(q, b, n_options):
    return {"b": b, "topic": q.topic, "qtype": q.qtype, "prompt": q.prompt, "marks": q.marks, "form_level": q.form_level, "n_options": n_options}


def _n_options(q):
    c = q.content if isinstance(q.content, dict) else {}
    return len(c.get("options") or c.get("items") or c.get("left") or [])


def run(dry_run=False, now=None):
    """Returns a summary dict. Safe to run any time and as often as you like."""
    now = now or timezone.now()
    form = dict(User.objects.filter(role="student").values_list("pk", "school_class__form_level"))
    questions = {q.pk: q for q in Question.objects.exclude(status=Question.ARCHIVED)}
    summary = {"subjects": {}, "measured": 0, "predicted": 0, "skipped_subjects": [], "predictor": None}
    measured_rows, pending = [], []     # pending: questions without enough answers (candidates for a prediction)
    update, cohorts = {}, {}            # cohorts[subject][form] = abilities of that form's students in this subject
    answered = Counter()

    for subject_id, resp in collect().items():
        triples = [(s, q, f) for (s, q), f in resp.items() if q in questions]
        for s, _, _ in triples:
            answered[s] += 1
        count = Counter(s for s, _, _ in triples)
        triples = [t for t in triples if count[t[0]] >= cal.MIN_STUDENT_RESPONSES]
        if len(triples) < MIN_SUBJECT_RESPONSES or len({t[0] for t in triples}) < MIN_SUBJECT_STUDENTS:
            summary["skipped_subjects"].append(subject_id)
            continue
        theta, items, comp_s = cal.fit_rasch(triples)
        by_form, by_comp_form = defaultdict(list), defaultdict(list)
        for s, th in theta.items():
            by_form[form.get(s) or 0].append(th)
            by_comp_form[(comp_s[s], form.get(s) or 0)].append(th)
        cohorts[subject_id] = by_form
        n_meas = 0
        for qid, it in items.items():
            q = questions[qid]
            if it["n"] < cal.MIN_RESPONSES:
                pending.append((q, it["n"]))
                continue
            respondents = Counter(form.get(s) or 0 for (s, qq), _ in resp.items() if qq == qid) if not q.form_level else None
            level = q.form_level or (respondents.most_common(1)[0][0] if respondents else 0)
            pool = by_comp_form.get((it["comp"], level)) or [th for (c, f), v in by_comp_form.items() if c == it["comp"] for th in v]
            p = cal.cohort_p(it["b"], pool)
            update[qid] = (it["b"], cal.label_for(p), it["n"], "data")
            measured_rows.append(_row(q, it["b"], _n_options(q)))
            n_meas += 1
        summary["subjects"][subject_id] = {"students": len(theta), "responses": len(triples), "questions": len(items), "measured": n_meas}
    summary["measured"] = len(update)

    # Questions nobody has answered enough yet: predict from the wording, but only with a model that proved itself.
    seen = {q.pk for q, _ in pending} | set(update)
    pending += [(q, 0) for q in questions.values() if q.pk not in seen and q.status == Question.APPROVED]
    if measured_rows and pending:
        model = cal.train_predictor(measured_rows)
        summary["predictor"] = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in model.items() if k in ("n", "mae", "baseline_mae", "usable", "reason")}
        if model.get("usable"):
            for q, n in pending:
                pool = (cohorts.get(q.subject_id) or {}).get(q.form_level or 0) or [t for v in (cohorts.get(q.subject_id) or {}).values() for t in v]
                if not pool:
                    continue
                b = cal.predict_difficulty(model, _row(q, 0.0, _n_options(q)))
                update[q.pk] = (b, cal.label_for(cal.cohort_p(b, pool)), n, "predicted")
                summary["predicted"] += 1

    if not dry_run and update:
        batch = []
        for qid, (b, label, n, src) in update.items():
            q = questions[qid]
            q.ml_difficulty, q.ml_label, q.ml_samples, q.ml_source, q.ml_updated = round(b, 4), label, n, src, now
            batch.append(q)
        Question.objects.bulk_update(batch, ["ml_difficulty", "ml_label", "ml_samples", "ml_source", "ml_updated"], batch_size=500)
    summary["labels"] = dict(Counter(v[1] for v in update.values()))
    return summary
