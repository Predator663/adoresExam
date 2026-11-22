"""Home packages: an exam printed on paper for students who have no smartphone or internet.

  1. An administrator picks the students and prints the package (cover, questions, answer sheet). Each student gets her own
     UNIQUE CODE, printed on every page and as a Code 128 barcode (PaperSheet).
  2. When the sheet comes back, scanning the barcode (or typing the code) finds the student and marks the sheet RECEIVED:
     she counts as submitted (see notsubmitted.py).
  3. The same screen opens the answer entry. The administrator keys in what the student wrote. Those answers become an ordinary
     Attempt that is auto-marked by the same rules as every online exam (services.compute_result), so results, class position,
     analytics and the answer review all work as usual. Keying in again replaces the earlier answers and re-marks.

Only administrators can do any of this. The printed question paper never contains the answers.
Run the tests:  python manage.py test exams.test_paper"""
import random
import re

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.permissions import IsAdminRole
from core.models import SchoolSettings, audit

from . import presenters, services
from .corrections import _snap
from .models import Answer, Attempt, Exam, ExamQuestion, PaperSheet, Result
from .sections import SECTION_ORDER, letters
from .services import ExamError

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0 O 1 I L: nobody can misread the printed code
CODE_LENGTH = 8
PRINTABLE = (Exam.LIVE, Exam.CLOSED, Exam.PUBLISHED)  # a package is printed for an exam that has started
MAX_TEXT = 500


# ---------------------------------------------------------------- codes

def normalize_code(raw):
    """What a scanner or a person typed -> the stored form ("k7m2-qx9r" and "K7M2QX9R " are the same code)."""
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())


def pretty_code(code):
    return f"{code[:4]}-{code[4:]}" if len(code) == CODE_LENGTH else code


def new_code():
    rnd = random.SystemRandom()
    while True:
        code = "".join(rnd.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if not PaperSheet.objects.filter(code=code).exists():
            return code


# ---------------------------------------------------------------- reading

def _name(u):
    return f"{u.first_name} {u.last_name}".strip() or u.username


def _class(u):
    c = u.school_class
    return f"{c.name} {c.stream}".strip() if c else ""


def paper_questions(exam):
    """The questions exactly as a student would see them, WITHOUT answers, in paper order. The order of choices is the same for
    everyone (the printed paper and the answer entry screen must agree on "B"), so choices are not re-shuffled per student."""
    rows = list(exam.questions.filter(voided=False).order_by("position"))
    sec = letters(r.payload.get("qtype") for r in rows)
    out = []
    for n, eq in enumerate(rows, 1):
        q = presenters.public_question(eq, exam.pk, False)
        q["number"], q["section"] = n, sec.get(q["type"], "")
        out.append(q)
    return out


def paper_sections(questions):
    have = {q["type"] for q in questions}
    sec = letters(have)
    return [{"letter": sec[k], "type": k, "title": title, "instructions": hint} for k, title, hint in SECTION_ORDER if k in have]


def _sheet_row(sheet):
    return {"code": sheet.code, "pretty": pretty_code(sheet.code), "received_at": sheet.received_at, "entered_at": sheet.entered_at}


def package(exam):
    """Everything the print page needs: the exam, the school, the questions, and the eligible students with their sheets."""
    services.sync_exam(exam)
    exam.refresh_from_db()
    if exam.status not in PRINTABLE:
        raise ExamError("A home package can be printed once the exam is live (or later).", 409, "not_open")
    sheets = {s.student_id: s for s in exam.paper_sheets.all()}
    latest = {}
    for a in exam.attempts.order_by("attempt_no"):
        latest[a.student_id] = a
    students = []
    for s in services.eligible_students(exam).select_related("school_class").order_by("school_class__form_level", "school_class__name", "first_name", "last_name", "id"):
        sheet = sheets.get(s.pk)
        a = latest.get(s.pk)
        students.append({"id": s.pk, "name": _name(s), "class": _class(s), "class_id": s.school_class_id, "index": s.index_number,
                         "sheet": _sheet_row(sheet) if sheet else None,
                         "online": bool(a and not sheet)})  # she already sat this exam online: no paper for her
    questions = paper_questions(exam)
    st = SchoolSettings.load()
    return {
        "exam": {"id": exam.pk, "title": exam.title, "subject": exam.subject.name, "status": exam.status, "start_at": exam.start_at, "end_at": exam.end_at,
                 "duration_minutes": exam.duration_minutes, "rules_text": exam.rules_text, "total_marks": sum(q["marks"] for q in questions),
                 "pass_mark_percent": exam.pass_mark_percent},
        "school": {"name": st.school_name, "logo": st.logo.url if st.logo else ""},
        "questions": questions, "sections": paper_sections(questions), "students": students,
        "counts": {"sheets": len(sheets), "received": sum(1 for s in sheets.values() if s.received_at), "entered": sum(1 for s in sheets.values() if s.entered_at)},
    }


# ---------------------------------------------------------------- making the sheets

@transaction.atomic
def make_sheets(exam_id, student_ids, admin):
    """Give each chosen student her unique code (keeps the code she already has). Returns the sheets of the chosen students."""
    exam = Exam.objects.select_for_update().get(pk=exam_id)
    services.sync_exam(exam)
    exam.refresh_from_db()
    if exam.status not in PRINTABLE:
        raise ExamError("A home package can be printed once the exam is live (or later).", 409, "not_open")
    wanted = {int(x) for x in student_ids}
    if not wanted:
        raise ExamError("Choose at least one student.", 400, "no_students")
    eligible = {s.pk: s for s in services.eligible_students(exam).filter(pk__in=wanted).select_related("school_class")}
    if len(eligible) != len(wanted):
        raise ExamError("Some of the chosen students are not part of this exam.", 400, "not_eligible")
    have = {s.student_id: s for s in exam.paper_sheets.filter(student_id__in=wanted)}
    online = set(exam.attempts.filter(student_id__in=wanted).values_list("student_id", flat=True)) - set(have)
    if online:
        names = ", ".join(_name(eligible[i]) for i in sorted(online))
        raise ExamError(f"These students already sat the exam online, so they need no paper: {names}.", 409, "already_online")
    made = 0
    for pk in sorted(wanted):
        if pk not in have:
            have[pk] = PaperSheet.objects.create(exam=exam, student=eligible[pk], code=new_code(), created_by=admin)
            made += 1
    audit(admin, "paper.print", exam, students=len(wanted), new_codes=made)
    return [{"student_id": pk, **_sheet_row(have[pk])} for pk in sorted(wanted)]


# ---------------------------------------------------------------- scanning

def _find(code):
    code = normalize_code(code)
    sheet = PaperSheet.objects.select_related("exam", "exam__subject", "student", "student__school_class").filter(code=code).first() if code else None
    if not sheet:
        raise ExamError("No home package has this code. Check the code and try again.", 404, "unknown_code")
    return sheet


def _answers_of(sheet):
    if not sheet.attempt_id:
        return {}
    return {a.exam_question_id: a.response for a in sheet.attempt.answers.all() if not a.skipped and a.response is not None}


def _result_of(sheet):
    r = Result.objects.filter(attempt_id=sheet.attempt_id).first() if sheet.attempt_id else None
    return {"score": r.score, "total": r.total, "percent": r.percent, "grade": r.grade, "passed": r.passed} if r else None


def _sheet_view(sheet, again=False):
    exam = sheet.exam
    qs = paper_questions(exam)
    return {
        "sheet": {**_sheet_row(sheet), "already_scanned": again},
        "student": {"id": sheet.student_id, "name": _name(sheet.student), "class": _class(sheet.student), "index": sheet.student.index_number},
        "exam": {"id": exam.pk, "title": exam.title, "subject": exam.subject.name, "status": exam.status, "total_marks": sum(q["marks"] for q in qs)},
        "questions": qs, "sections": paper_sections(qs),
        "answers": {str(k): v for k, v in _answers_of(sheet).items()},
        "result": _result_of(sheet),
    }


@transaction.atomic
def scan(code, admin):
    """Scanning marks the sheet received (the student counts as submitted) and returns everything the entry screen needs."""
    sheet = _find(code)
    sheet = PaperSheet.objects.select_for_update(of=("self",)).select_related("exam", "exam__subject", "student", "student__school_class").get(pk=sheet.pk)
    again = sheet.received_at is not None
    if not again:
        sheet.received_at, sheet.received_by = timezone.now(), admin
        sheet.save(update_fields=["received_at", "received_by"])
        audit(admin, "paper.received", sheet.exam, student=sheet.student.username, code=sheet.code)
    return _sheet_view(sheet, again)


# ---------------------------------------------------------------- keying in the answers

def _clean(eq, value, number):
    """One keyed-in answer -> the same shape an online answer has, or None when it was left empty."""
    if value in (None, "", [], {}):
        return None
    p = eq.payload
    t, c = p["qtype"], p.get("content", {})

    def bad(why="does not fit the question"):
        return ExamError(f"Question {number}: the answer {why}.", 400, "bad_answer")

    if t == "mcq_single":
        if not isinstance(value, str) or value not in {o["id"] for o in c.get("options", [])}:
            raise bad("is not one of the choices")
        return value
    if t == "mcq_multi":
        ids = {o["id"] for o in c.get("options", [])}
        if not isinstance(value, list) or any(not isinstance(x, str) or x not in ids for x in value):
            raise bad("is not made of the choices")
        return [o["id"] for o in c["options"] if o["id"] in set(value)]
    if t == "true_false":
        if not isinstance(value, bool):
            raise bad("must be True or False")
        return value
    if t == "fill_blank":
        text = str(value).strip()
        if len(text) > MAX_TEXT:
            raise bad("is too long")
        return text or None
    if t == "matching":
        left, right = {x["id"] for x in c.get("left", [])}, {x["id"] for x in c.get("right", [])}
        if not isinstance(value, dict) or any(k not in left or not isinstance(v, str) or v not in right for k, v in value.items() if v):
            raise bad("has a pair that does not exist")
        return {k: v for k, v in value.items() if v} or None
    if t == "fill_multi":
        blanks = {b["id"] for b in c.get("blanks", [])}
        bank = {w["id"] for w in c.get("bank", [])} if c.get("mode") == "bank" else None
        if not isinstance(value, dict) or any(k not in blanks for k in value):
            raise bad("has a blank that does not exist")
        out = {}
        for k, v in value.items():
            v = str(v).strip()
            if not v:
                continue
            if bank is not None and v not in bank:
                raise bad("uses a word that is not in the word bank")
            if len(v) > MAX_TEXT:
                raise bad("is too long")
            out[k] = v
        return out or None
    if t == "ordering":
        ids = [i["id"] for i in c.get("items", [])]
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value) or sorted(value) != sorted(ids):
            raise bad("must put every item in order, each one once")
        return value
    raise bad()


@transaction.atomic
def save_answers(code, answers, admin, now=None):
    """Key in (or correct) the answers of one sheet. `answers`: {question id: response}. Replaces what was keyed in before, then marks."""
    now = now or timezone.now()
    sheet = PaperSheet.objects.select_for_update().get(pk=_find(code).pk)
    exam = Exam.objects.select_for_update().select_related("subject").get(pk=sheet.exam_id)
    services.sync_exam(exam, now)
    exam.refresh_from_db()
    if exam.status not in PRINTABLE:
        raise ExamError("This exam is not open yet.", 409, "not_open")
    if not isinstance(answers, dict):
        raise ExamError("Send the answers as {question id: answer}.", 400, "bad_body")
    rows = list(exam.questions.filter(voided=False).order_by("position"))
    by_id = {str(eq.pk): eq for eq in rows}
    if any(k not in by_id for k in answers):
        raise ExamError("An answer belongs to a question that is not in this exam.", 400, "bad_question")
    clean = {eq.pk: _clean(eq, answers.get(str(eq.pk)), n) for n, eq in enumerate(rows, 1)}

    at = min(now, exam.end_at)  # the paper counts as handed in at the latest when the exam ended: results are released with everyone else's
    before = None
    if sheet.attempt_id:
        attempt = Attempt.objects.select_for_update().get(pk=sheet.attempt_id)
        old = Result.objects.filter(attempt=attempt).first()
        before = _snap(old) if old else None
        attempt.answers.all().delete()
    else:
        if Attempt.objects.filter(exam=exam, student_id=sheet.student_id).exists():
            raise ExamError("This student already sat the exam online. Her online result stands.", 409, "already_online")
        attempt = Attempt.objects.create(exam=exam, student_id=sheet.student_id, attempt_no=1, status=Attempt.SUBMITTED, started_at=at, deadline_at=at,
                                         submitted_at=at, order=[eq.pk for eq in rows], current_index=len(rows))
    Answer.objects.bulk_create([Answer(attempt=attempt, exam_question=eq, response=clean[eq.pk], skipped=clean[eq.pk] is None) for eq in rows])
    result = services.compute_result(attempt, rows)

    if before and services.result_visible(attempt, now) and any(before[k] != v for k, v in _snap(result).items() if k != "percent"):
        # she has already been able to see the earlier mark: show her that it was updated (the same banner a corrected answer key uses)
        result.revision, result.corrected_at, result.previous = result.revision + 1, now, before
        result.save(update_fields=["revision", "corrected_at", "previous"])

    sheet.attempt, sheet.entered_at, sheet.entered_by = attempt, now, admin
    if not sheet.received_at:
        sheet.received_at, sheet.received_by = now, admin
    sheet.save(update_fields=["attempt", "entered_at", "entered_by", "received_at", "received_by"])
    audit(admin, "paper.entered", exam, student=sheet.student.username, code=sheet.code, answered=sum(1 for v in clean.values() if v is not None),
          score=result.score, redo=before is not None)
    return {"result": {"score": result.score, "total": result.total, "percent": result.percent, "grade": result.grade, "passed": result.passed},
            "answered": sum(1 for v in clean.values() if v is not None), "questions": len(rows), "redo": before is not None}


# ---------------------------------------------------------------- HTTP

def _err(e):
    return Response({"detail": e.message, "code": e.code}, status=e.status)


@api_view(["GET"])
@permission_classes([IsAdminRole])
def package_view(request, exam_id):
    exam = get_object_or_404(Exam.objects.select_related("subject"), pk=exam_id)
    try:
        data = package(exam)
    except ExamError as e:
        return _err(e)
    if data["school"]["logo"]:
        data["school"]["logo"] = request.build_absolute_uri(data["school"]["logo"])
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAdminRole])
def sheets_view(request, exam_id):
    get_object_or_404(Exam, pk=exam_id)
    try:
        ids = request.data.get("students")
        if not isinstance(ids, list):
            raise ExamError("Send the chosen students as a list.", 400, "bad_body")
        return Response(make_sheets(exam_id, ids, request.user))
    except (TypeError, ValueError):
        return Response({"detail": "The students must be a list of ids.", "code": "bad_body"}, status=400)
    except ExamError as e:
        return _err(e)


@api_view(["POST"])
@permission_classes([IsAdminRole])
def scan_view(request):
    try:
        return Response(scan(request.data.get("code"), request.user))
    except ExamError as e:
        return _err(e)


@api_view(["POST"])
@permission_classes([IsAdminRole])
def answers_view(request):
    try:
        return Response(save_answers(request.data.get("code"), request.data.get("answers"), request.user))
    except ExamError as e:
        return _err(e)
