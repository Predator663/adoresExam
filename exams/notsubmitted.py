"""Admin panel: who did NOT submit an exam, with search, filters and printing.

  GET /api/exams/not-submitted/options/   exams that have started (newest first) and the classes
  GET /api/exams/not-submitted/           the list as JSON
  GET /api/exams/not-submitted/export/    the same list as PDF or Excel (?file=pdf|xlsx)

Filters (all three calls): exam=<id> (required), class=<id>, q=<name / username / index number>,
status=none,writing,auto (default none,writing), sort=name|class|status|index, dir=asc|desc, parents=1.
Each row also says `retake_allowed` (an administrator has allowed her to sit and she has not started yet). The allow / take-back buttons
call POST /api/exams/<id>/grant-retakes/ and /revoke-retakes/ (exams/views.py).

Who counts as "not submitted":
  none     never opened the exam (no attempt at all)
  writing  started and has not pressed Submit yet (only while the exam is still running)
  auto     started but never pressed Submit: the clock ran out and the system submitted for her (off by default)
The latest attempt decides, so a student who was given a retake is judged on the retake.

Parent phone numbers are shown only when parents=1 is asked for. That is written to the audit log (who, which exam, how
many students), because the numbers are private. Administrators only.
"""
from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from academics.models import SchoolClass
from accounts.permissions import IsAdminRole
from core import notsubmitted_report
from core.models import SchoolSettings, audit
from . import services
from .models import Attempt, Exam, ExamGrant

STATUS_LABEL = {"none": "Did not sit", "writing": "Still writing", "auto": "Not submitted: time ran out"}
SORTS = ("name", "class", "status", "index")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _full_name(u):
    return f"{u.first_name} {u.last_name}".strip() or u.username


def _guardians(student_ids):
    """{student_id: [{name, phone, relationship}]} with FULL numbers. Only called when parents=1 was asked for."""
    out = {}
    try:
        from guardians.models import GuardianLink
        for link in GuardianLink.objects.filter(student_id__in=student_ids).select_related("guardian").order_by("id"):
            g = link.guardian
            out.setdefault(link.student_id, []).append({"name": g.name, "phone": str(g.phone or ""), "relationship": g.relationship or ""})
    except Exception:  # a parent lookup problem must never hide the list itself
        pass
    return out


def collect(request):
    """Read and check the filters, then build the rows."""
    p = request.query_params
    try:
        exam_id = int(p.get("exam", ""))
    except ValueError:
        raise ValidationError({"detail": "Choose an exam first."})
    exam = get_object_or_404(Exam.objects.select_related("subject").prefetch_related("classes"), pk=exam_id)
    if exam.status == Exam.DRAFT or not exam.start_at:
        raise ValidationError({"detail": "That exam has not been scheduled yet."})
    now = timezone.now()
    services.sync_exam(exam, now)

    wanted = [x for x in (p.get("status") or "none,writing").split(",") if x]
    if not wanted or any(x not in STATUS_LABEL for x in wanted):
        raise ValidationError({"detail": "Unknown status filter."})
    sort = p.get("sort", "class")
    if sort not in SORTS:
        raise ValidationError({"detail": "Choose one of the listed ways to sort."})
    direction = p.get("dir", "asc")
    if direction not in ("asc", "desc"):
        raise ValidationError({"detail": "Sort direction must be asc or desc."})
    q = (p.get("q") or "").strip().lower()
    class_id = None
    if p.get("class"):
        try:
            class_id = int(p["class"])
        except ValueError:
            raise ValidationError({"detail": "The class filter must be a number."})
        klass = get_object_or_404(SchoolClass, pk=class_id)

    eligible = list(services.eligible_students(exam).select_related("school_class"))
    latest = {}
    for a in exam.attempts.order_by("attempt_no"):
        latest[a.student_id] = a
    people = {s.pk: s for s in eligible}

    def status_of(s):
        a = latest.get(s.pk)
        if a is None:
            return "none"
        if a.status == Attempt.IN_PROGRESS:
            return "writing"
        return "auto" if a.status == Attempt.AUTO_SUBMITTED else "submitted"

    all_states = {s.pk: status_of(s) for s in eligible}
    in_scope = [s for s in eligible if not class_id or s.school_class_id == class_id]
    states = {s.pk: all_states[s.pk] for s in in_scope}
    counts = {k: sum(1 for v in states.values() if v == k) for k in ("none", "writing", "auto", "submitted")}

    def matches(s):
        if states[s.pk] not in wanted:
            return False
        if not q:
            return True
        hay = f"{s.first_name} {s.last_name} {s.username} {s.index_number}".lower()
        return all(part in hay for part in q.split())

    shown = [s for s in in_scope if matches(s)]
    rank = {"none": 0, "writing": 1, "auto": 2}
    keys = {"name": lambda s: (_full_name(s).lower(), s.pk),
            "class": lambda s: ((s.school_class.form_level, str(s.school_class)) if s.school_class_id else (99, ""), _full_name(s).lower(), s.pk),
            "status": lambda s: (rank[states[s.pk]], _full_name(s).lower(), s.pk),
            "index": lambda s: (s.index_number or "~", s.pk)}
    shown.sort(key=keys[sort], reverse=(direction == "desc"))

    allowed = set(ExamGrant.objects.filter(exam=exam, kind=ExamGrant.RETAKE, used=False).values_list("student_id", flat=True))  # permission given, not used yet
    with_parents = p.get("parents") in ("1", "true", "yes")
    guardians = _guardians([s.pk for s in shown]) if with_parents else {}
    rows = []
    for s in shown:
        a = latest.get(s.pk)
        rows.append({"id": s.pk, "name": _full_name(s), "index": s.index_number, "class": str(s.school_class) if s.school_class_id else "-",
                     "status": states[s.pk], "status_label": STATUS_LABEL[states[s.pk]],
                     "started_at": a.started_at if a else None, "attempt_no": a.attempt_no if a else None,
                     "started_text": timezone.localtime(a.started_at).strftime("%d %b, %H:%M") if a else "-",
                     "retake_allowed": s.pk in allowed, "parents": guardians.get(s.pk, [])})

    by_class = {}
    for s in eligible:  # every class of the exam, whatever class is picked, so the person can switch between them
        c = str(s.school_class) if s.school_class_id else "-"
        d = by_class.setdefault(c, {"class": c, "eligible": 0, "not_submitted": 0, "form": s.school_class.form_level if s.school_class_id else 99})
        d["eligible"] += 1
        d["not_submitted"] += 1 if all_states[s.pk] in ("none", "writing") else 0
    classes = sorted(by_class.values(), key=lambda d: (d["form"], d["class"]))

    eligible_n = len(in_scope)
    not_sub = counts["none"] + counts["writing"]
    summary = {"eligible": eligible_n, "submitted": counts["submitted"] + counts["auto"], "not_submitted": not_sub,
               "none": counts["none"], "writing": counts["writing"], "auto": counts["auto"],
               "pct_submitted": round(100 * (counts["submitted"] + counts["auto"]) / eligible_n, 1) if eligible_n else None,
               "listed": len(rows), "allowed": sum(1 for s in in_scope if s.pk in allowed and states[s.pk] in ("none", "writing", "auto"))}
    classes_label = ", ".join(str(c) for c in exam.classes.all()) or "Selected students"
    filters = [("Exam", exam.title), ("Subject", exam.subject.name), ("Classes", classes_label),
               ("Held", f"{timezone.localtime(exam.start_at):%d %b %Y, %H:%M} to {timezone.localtime(exam.end_at):%H:%M}" if exam.end_at else f"{timezone.localtime(exam.start_at):%d %b %Y, %H:%M}"),
               ("Showing", " + ".join(STATUS_LABEL[x] for x in STATUS_LABEL if x in wanted))]
    if class_id:
        filters.append(("Class filter", str(klass)))
    if q:
        filters.append(("Search", p["q"].strip()))
    if with_parents:
        filters.append(("Parent contacts", "included"))
    return {"exam": exam, "rows": rows, "summary": summary, "classes": classes, "filters": filters, "wanted": wanted,
            "with_parents": with_parents, "sort": sort, "dir": direction, "now": now}


def _audit_parents(request, ctx, via):
    if ctx["with_parents"]:
        audit(request.user, "export.not_submitted_parents", ctx["exam"].pk, via=via, students=len(ctx["rows"]))


@api_view(["GET"])
@permission_classes([IsAdminRole])
def not_submitted_options(request):
    """Exams that have started (a draft or future exam has nobody to miss), newest first."""
    now = timezone.now()
    exams = (Exam.objects.exclude(status=Exam.DRAFT).filter(start_at__isnull=False, start_at__lte=now)
             .select_related("subject").prefetch_related("classes").order_by("-start_at")[:300])
    return Response({
        "exams": [{"id": e.pk, "title": e.title, "subject": e.subject.name, "status": e.status, "start_at": e.start_at, "end_at": e.end_at,
                   "classes": [str(c) for c in e.classes.all()]} for e in exams],
        "classes": [{"id": c.pk, "label": str(c)} for c in SchoolClass.objects.all()],
    })


@api_view(["GET"])
@permission_classes([IsAdminRole])
def not_submitted(request):
    ctx = collect(request)
    e = ctx["exam"]
    _audit_parents(request, ctx, "screen")
    return Response({
        "exam": {"id": e.pk, "title": e.title, "subject": e.subject.name, "status": e.status, "start_at": e.start_at, "end_at": e.end_at},
        "summary": ctx["summary"], "classes": ctx["classes"], "rows": ctx["rows"],
        "filters": [{"label": k, "value": v} for k, v in ctx["filters"]], "generated": ctx["now"],
    })


@api_view(["GET"])
@permission_classes([IsAdminRole])
def not_submitted_export(request):
    kind = request.query_params.get("file", "pdf")
    if kind not in ("pdf", "xlsx"):
        raise ValidationError({"detail": "Choose PDF or Excel."})
    ctx = collect(request)
    school = SchoolSettings.load()
    from analytics.views import _logo_bytes
    meta = {"school": school.school_name, "address": school.address,
            "contact": " | ".join(x for x in (school.contact_email, school.contact_phone) if x), "logo": _logo_bytes(school),
            "title": "Students who have not submitted the exam", "filters": ctx["filters"],
            "generated": timezone.localtime().strftime("%d %b %Y, %H:%M"), "sort": ""}
    audit(request.user, "export.not_submitted", ctx["exam"].pk, file=kind, students=len(ctx["rows"]))
    _audit_parents(request, ctx, kind)
    name = f"{slugify(school.school_name) or 'school'}_not-submitted_{slugify(ctx['exam'].title)[:40]}_{timezone.localdate():%Y-%m-%d}"
    from analytics.views import _download
    if kind == "pdf":
        return _download(notsubmitted_report.pdf(meta, ctx), "application/pdf", f"{name}.pdf")
    return _download(notsubmitted_report.xlsx(meta, ctx), XLSX, f"{name}.xlsx")
