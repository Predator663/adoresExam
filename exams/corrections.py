"""Correcting a wrong answer key AFTER the exam, and re-marking everything that depended on it.

What an administrator does: opens a closed or published exam, picks the question, fixes its answer key (and, if needed, the marks or the
explanation), writes the reason, previews the effect, applies it. What the system then does, in ONE database transaction (all or nothing):

  1. saves the corrected key in the exam's own copy of the question (an exam keeps its own copy of every question, QB-11);
  2. re-marks EVERY submitted attempt of the exam with the same marking code used the first time (services.compute_result), so every
     answer's marks, every score, percentage, grade, pass/fail, topic breakdown and class position are right;
  3. for each result that really moved: remembers what it was before (Result.previous, ResultChange), counts it (Result.revision),
     and settles the XP the exam earned the student so the ledger matches her new mark (gamification.reconcile_exam_rewards);
  4. fixes the question in the question bank too when the bank still has the old key, and in exams not started yet that copied it;
  5. writes an ExamCorrection record (who, why, before, after, how many moved) and an audit log entry;
  6. only after the commit: tells every student whose result moved (in her language) and the subject's teachers.

Nothing else needs refreshing: the app never caches results (the service worker skips /api/), analytics and staff tables read the same Result rows.
A preview runs steps 1 to 3 for real inside a transaction that is then rolled back, so it shows exactly what applying would do."""
import copy

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from academics.models import TeacherAssignment
from core.models import audit
from core.sanitize import clean_html
from questions.models import Question, QuestionVersion
from questions.validation import validate_question
from . import services
from .models import Answer, Attempt, Exam, ExamCorrection, ExamQuestion, Result, ResultChange, SavedQuestion
from .services import ExamError

ID_KEYS = ("options", "left", "right", "items", "blanks", "bank")  # lists of choices whose ids students' answers refer to
MAX_ROWS = 200  # students listed in a preview / history (the counts are always for everybody)


# ---------------------------------------------------------------- building the corrected question
def _msg(e):
    d = e.detail
    parts = []
    for v in (d.values() if isinstance(d, dict) else [d]):
        parts += [str(x) for x in (v if isinstance(v, list) else [v])]
    return " ".join(parts) or "That answer key is not valid."


def _ids(content):
    return {k: sorted(str(i.get("id")) for i in content.get(k, [])) for k in ID_KEYS if isinstance(content.get(k), list)}


def _norm(p):
    """The correctable parts, with a missing explanation equal to an empty one (so "nothing changed" is detected)."""
    v = view(p)
    v["explanation"] = v.get("explanation") or ""
    return v


def view(payload):
    """The parts a correction can touch (stored in the correction record, shown in the history)."""
    return {k: payload.get(k) for k in ("answer", "content", "marks", "explanation")}


def build_payload(payload, changes):
    """The question as it will be after the correction. `changes` may hold answer, content (the same choices, maybe in a new order, for
    ordering questions), marks and explanation. The question type, text and the choices themselves cannot change: students already answered them."""
    if not isinstance(changes, dict):
        raise ExamError("Send the corrected answer.", 400, "bad_request")
    new = copy.deepcopy(payload)
    content = changes["content"] if isinstance(changes.get("content"), dict) else new.get("content") or {}
    answer = changes["answer"] if isinstance(changes.get("answer"), dict) else new.get("answer") or {}
    if _ids(content) != _ids(new.get("content") or {}):
        raise ExamError("You can fix which answer is right, but not add or remove choices: students have already answered this question.", 400, "choices_changed")
    try:
        new["content"], new["answer"] = validate_question(new["qtype"], content, answer, new.get("prompt", ""))
    except ValidationError as e:
        raise ExamError(_msg(e), 400, "invalid_answer")
    old_bank = (payload.get("content") or {}).get("bank")
    if new["qtype"] == "fill_multi" and (payload.get("content") or {}).get("mode") == "bank" and isinstance(old_bank, list):
        # students' answers are word-bank ids: validate_question rebuilds the bank from the accepted answers, which would change what each id means
        new["content"] = {**new["content"], "mode": "bank", "bank": copy.deepcopy(old_bank)}
    if "marks" in changes and changes["marks"] not in (None, ""):
        try:
            m = float(changes["marks"])
        except (TypeError, ValueError):
            raise ExamError("Marks must be a number.", 400, "bad_marks")
        if not 0 < m <= 1000:
            raise ExamError("Marks must be above zero.", 400, "bad_marks")
        new["marks"] = int(m) if m == int(m) else round(m, 2)
    if "explanation" in changes:
        new["explanation"] = clean_html(str(changes["explanation"] or ""))[:5000]
    return new


# ---------------------------------------------------------------- reading a result
def _snap(r):
    return {"score": round(r.score, 2), "total": round(r.total, 2), "percent": round(r.percent, 2), "grade": r.grade, "passed": bool(r.passed)}


def _moved(b, a):
    return any(b[k] != a[k] for k in ("score", "total", "grade", "passed"))  # percent follows from score and total


def _class_label(student):
    c = student.school_class
    return f"{c.name} {c.stream}".strip() if c else ""


def _row(a, b, n):
    return {"attempt_id": a.pk, "student_id": a.student_id, "student": a.student.get_full_name() or a.student.username,
            "class": _class_label(a.student), "before": b, "after": n}


def key_info(eq):
    """What the correction screen needs: the question with its CURRENT key, and how the class answered it (a key that nearly nobody
    matches is the usual sign that the key is wrong)."""
    rows = list(eq.answers.exclude(attempt__status=Attempt.IN_PROGRESS).values_list("response", "skipped", "marks_awarded"))
    p, full = eq.payload, eq.payload.get("marks", 0)
    dist, answered, right = {}, 0, 0
    for resp, skipped, got in rows:
        if skipped or resp is None:
            continue
        answered += 1
        right += 1 if (got or 0) >= full - 1e-9 else 0
        picks = resp if isinstance(resp, list) else [resp]
        if p["qtype"] in ("mcq_single", "mcq_multi", "true_false"):
            for x in picks:
                k = str(x).lower() if isinstance(x, bool) else str(x)
                dist[k] = dist.get(k, 0) + 1
    return {"exam_question_id": eq.pk, "number": eq.position, "voided": eq.voided, "qtype": p["qtype"], "prompt": p.get("prompt", ""),
            "content": p.get("content", {}), "answer": p.get("answer", {}), "marks": p.get("marks"), "explanation": p.get("explanation", ""),
            "topic": p.get("topic", ""), "stats": {"answered": answered, "fully_correct": right,
                                                   "percent_correct": round(right / answered * 100, 1) if answered else None, "choices": dist}}


# ---------------------------------------------------------------- the correction
def correct(exam_id, eq_id, changes, reason, by, *, preview=False, notify=True, update_bank=True):
    reason = (reason or "").strip()
    if not reason:
        raise ExamError("Please give a reason: students and teachers will be shown it.", 400, "reason_required")
    now = timezone.now()
    with transaction.atomic():
        exam = Exam.objects.select_for_update().select_related("subject").get(pk=exam_id)  # one correction at a time per exam
        services.sync_exam(exam, now)
        exam.refresh_from_db()
        if exam.status not in (Exam.CLOSED, Exam.PUBLISHED):
            raise ExamError("A question can be corrected only after the exam has closed.", 409, "not_closed")
        eq = exam.questions.select_for_update().filter(pk=eq_id).first()
        if eq is None:
            raise ExamError("That question is not in this exam.", 404, "no_question")
        if eq.voided:
            raise ExamError("This question was voided, so it counts for nobody. Nothing to correct.", 409, "voided")
        before = copy.deepcopy(eq.payload)
        after = build_payload(before, changes)
        if _norm(after) == _norm(before):
            raise ExamError("That is exactly what is saved already: nothing to correct.", 400, "no_change")

        attempts = list(exam.attempts.exclude(status=Attempt.IN_PROGRESS).select_related("exam", "student__school_class").prefetch_related("answers"))
        old = {r.attempt_id: _snap(r) for r in Result.objects.filter(attempt_id__in=[a.pk for a in attempts])}
        eq.payload = after
        eq.save(update_fields=["payload"])
        paper = list(exam.questions.all())  # loaded once for every student (compute_result would otherwise reload every question's JSON per student)
        corr = ExamCorrection.objects.create(exam=exam, exam_question=eq, number=eq.position, by=by, reason=reason[:300], before=view(before), after=view(after))

        moved, up, down = [], 0, 0
        for a in attempts:
            res = services.compute_result(a, paper)  # the same marking as the first time; also re-marks each Answer
            now_snap, prev = _snap(res), old.get(a.pk)
            if prev is None or not _moved(prev, now_snap):
                continue
            if exam.status == Exam.PUBLISHED and services.result_visible(a, now):
                # only a result she has already been able to see is "updated": otherwise she would be shown a mark she never saw
                res.revision, res.corrected_at, res.previous = res.revision + 1, now, prev
                res.save(update_fields=["revision", "corrected_at", "previous"])
            ResultChange.objects.create(correction=corr, result=res, student=a.student, before=prev, after=now_snap)
            up += now_snap["percent"] > prev["percent"]
            down += now_snap["percent"] < prev["percent"]
            moved.append((a, res, prev, now_snap))
            try:
                with transaction.atomic():  # a hiccup in the rewards must never undo a correction
                    from gamification import services as gam
                    gam.reconcile_exam_rewards(a, res)
            except Exception:
                pass
        corr.students, corr.changed, corr.up, corr.down = len(attempts), len(moved), up, down
        _refresh_saved(eq, after, [a.pk for a in attempts])

        bank, future, also = False, 0, []
        if eq.source_id:
            q = Question.objects.select_for_update().filter(pk=eq.source_id).first()
            if q and update_bank and q.answer == before.get("answer"):
                q.answer, q.content, q.explanation = after["answer"], after["content"], after.get("explanation", q.explanation)  # marks are this exam's own
                q.version += 1
                q.save(update_fields=["answer", "content", "explanation", "version"])
                QuestionVersion.objects.create(question=q, version=q.version, edited_by=by, snapshot={
                    f: getattr(q, f) for f in ("subject_id", "form_level", "topic", "subtopic", "difficulty", "marks", "language", "qtype", "prompt", "content", "answer", "explanation")})
                bank = True
            for other in ExamQuestion.objects.filter(source_id=eq.source_id).exclude(pk=eq.pk).select_related("exam"):
                if other.payload.get("answer") != before.get("answer"):
                    continue  # that exam already has a different key: leave it alone
                if other.exam.status in (Exam.DRAFT, Exam.SCHEDULED) and update_bank:
                    other.payload = {**other.payload, "answer": after["answer"], "content": after["content"],
                                     "explanation": after.get("explanation", other.payload.get("explanation", ""))}
                    other.save(update_fields=["payload"])
                    future += 1
                elif other.exam.status in (Exam.LIVE, Exam.CLOSED, Exam.PUBLISHED):
                    also.append({"exam_id": other.exam_id, "exam": other.exam.title, "status": other.exam.status, "exam_question_id": other.pk, "number": other.position})
        corr.bank_updated = bank
        corr.save()

        listed = sorted(moved, key=lambda m: -abs(m[3]["percent"] - m[2]["percent"]))[:MAX_ROWS]
        out = {"preview": preview, "correction_id": None if preview else corr.pk, "number": eq.position, "students": len(attempts), "changed": len(moved),
               "unchanged": len(attempts) - len(moved), "up": up, "down": down,
               "pass_gained": sum(1 for _, _, b, n in moved if n["passed"] and not b["passed"]),
               "pass_lost": sum(1 for _, _, b, n in moved if b["passed"] and not n["passed"]),
               "rows": [_row(a, b, n) for a, _, b, n in listed], "bank_updated": bank, "future_exams_updated": future, "also_in": also,
               "visible_now": exam.status == Exam.PUBLISHED}
        if preview:
            transaction.set_rollback(True)  # everything above is undone: the preview changed nothing
            return out
        audit(by, "exam.correct_question", eq.pk, exam=exam.pk, number=eq.position, reason=reason, students=len(attempts), changed=len(moved), up=up, down=down)
        tell = [(a.student_id, a.pk, b["percent"], n["percent"], n["grade"]) for a, _, b, n in moved if exam.status == Exam.PUBLISHED and services.result_visible(a, now)]
        info = (corr.pk, exam.pk, exam.title, eq.position, len(moved), len(attempts), exam.subject_id, exam.created_by_id, by.pk if by else None)
        if notify:
            transaction.on_commit(lambda: _tell(info, tell))
    return out


def _refresh_saved(eq, after, attempt_ids):
    """Students bookmark questions from their review; the bookmark keeps a private COPY of the answer key. Bring those copies up to date,
    so nobody keeps studying the old, wrong answer."""
    saved = list(SavedQuestion.objects.filter(attempt_id__in=attempt_ids, number=eq.position))
    if not saved:
        return
    got = dict(Answer.objects.filter(exam_question=eq, attempt_id__in=attempt_ids).values_list("attempt_id", "marks_awarded"))
    for sv in saved:
        sv.snapshot = {**sv.snapshot, "answer": after["answer"], "content": after["content"], "marks": after.get("marks", sv.snapshot.get("marks")),
                       "explanation": after.get("explanation", ""), "marks_awarded": got.get(sv.attempt_id) or 0}
    SavedQuestion.objects.bulk_update(saved, ["snapshot"])


def _tell(info, tell):
    """After the commit: every student whose result moved, in her own language, then the subject's teachers. Never raises."""
    corr_id, exam_id, title, number, changed, students, subject_id, creator_id, by_id = info
    sent = 0
    try:
        from notifications.services import notify_i18n
        pct = lambda x: f"{round(x, 1):g}"
        for sid, attempt_id, b, a, grade in tell:
            try:
                sent += notify_i18n([sid], "result_updated", "result.updated.title", "result.updated.body",
                                    {"title": title, "before": pct(b), "after": pct(a), "grade": grade}, key=f"correct:{corr_id}", data={"attempt_id": attempt_id, "exam_id": exam_id})
            except Exception:
                continue
        staff = set(TeacherAssignment.objects.filter(subject_id=subject_id).values_list("teacher_id", flat=True)) | ({creator_id} if creator_id else set())
        staff.discard(by_id)
        if staff:
            notify_i18n(list(staff), "result_updated", "correction.staff.title", "correction.staff.body",
                        {"title": title, "number": number, "changed": changed, "students": students}, key=f"correctstaff:{corr_id}", data={"exam_id": exam_id})
        ExamCorrection.objects.filter(pk=corr_id).update(notified=sent)
    except Exception:
        pass


def history(exam, full=False):
    """The corrections of an exam, newest first, each with the students it moved."""
    out = []
    for c in exam.corrections.select_related("by"):
        changes = c.changes.select_related("student__school_class")
        if not full:
            changes = changes[:20]
        out.append({"id": c.pk, "number": c.number, "reason": c.reason, "created_at": c.created_at, "by": (c.by.get_full_name() or c.by.username) if c.by else "",
                    "students": c.students, "changed": c.changed, "up": c.up, "down": c.down, "notified": c.notified, "bank_updated": c.bank_updated,
                    "before": c.before, "after": c.after,
                    "changes": [{"student": ch.student.get_full_name() or ch.student.username, "class": _class_label(ch.student), "before": ch.before, "after": ch.after} for ch in changes]})
    return out
