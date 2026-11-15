import csv
import io
import logging
import re
from datetime import timedelta

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Exists, OuterRef, Q
from django.contrib.auth.hashers import make_password
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import SchoolClass, TeacherAssignment
from core import reports
from core.models import SchoolSettings, audit
from notifications.services import notify_password_changed
from .hashers import InitialPasswordHasher
from .models import THEMES, BulkUploadBatch, User
from .permissions import IsAdminRole, IsSuperAdmin
from .throttles import LoginIPThrottle, LoginUserThrottle
from . import temp_password
from .services import (TEMPLATE_COLUMNS, create_students, generate_password, parse_upload, validate_rows,
                       validate_staff_password)

MAX_FAILED = 5  # no longer locks anyone; only used by the Locked accounts screen to flag "warning" accounts
LOCK_MINUTES = 15
FRIENDLY_FAIL = "Wrong username or password. Please check and try again."


def is_locked(u, now=None):
    """True while a user is locked out by too many wrong passwords."""
    return bool(u.locked_until and u.locked_until > (now or timezone.now()))


def unlock_user(u):
    """Lift a lock-out WITHOUT touching the password (the student only mistyped it)."""
    u.failed_logins, u.locked_until = 0, None
    u.save(update_fields=["failed_logins", "locked_until"])


def user_payload(u):
    return {
        "id": u.pk, "username": u.username, "first_name": u.first_name, "last_name": u.last_name,
        "role": u.role, "class": str(u.school_class) if u.school_class else None,
        "must_change_password": u.must_change_password, "language": u.language, "theme": u.theme,
        "accessibility": {
            "text_size": u.text_size, "line_spacing": u.line_spacing, "dyslexia_font": u.dyslexia_font,
            "reduce_motion": u.reduce_motion, "read_aloud": u.read_aloud,
        },
    }


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginIPThrottle, LoginUserThrottle]  # per user name and per address (accounts/throttles.py)

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""
        user = User.objects.filter(username__iexact=username).first() if username else None
        now = timezone.now()
        # No lock-out: a wrong password never blocks the account. Every wrong try is counted instead, so administrators
        # can see them in Login activity (audit entries "login.failed"; `failed_logins` = wrong tries since the last good login).
        authed = user if (user and user.is_active and user.check_password(password)) else None  # same user row: no second query
        if not authed:
            if user:
                user.failed_logins = min(user.failed_logins + 1, 30000)
                user.save(update_fields=["failed_logins"])
                audit(user, "login.failed", user.pk)
            return Response({"detail": FRIENDLY_FAIL}, status=400)
        if authed.is_archived:
            return Response({"detail": FRIENDLY_FAIL}, status=400)
        if temp_password.expired(authed, now):  # a starting password nobody used in time stops working; the office issues a new one
            return Response({"detail": "Your starting password has expired. Please ask the school office for a new one."}, status=400)
        if authed.failed_logins or authed.locked_until:  # nothing to clear for most logins: skip the write
            authed.failed_logins, authed.locked_until = 0, None
            authed.save(update_fields=["failed_logins", "locked_until"])
        # AUTH-09: one active session. A new login replaces the old token, ending the first session.
        Token.objects.filter(user=authed).delete()
        token = Token.objects.create(user=authed)
        audit(authed, "login", authed.pk)
        try:  # a student logging in again while an exam attempt runs is recorded for the anti-cheat review; it must never block a login
            from proctoring import services as proctoring
            proctoring.note_login(authed, ip=proctoring.client_ip(request), ua=request.META.get("HTTP_USER_AGENT", "")[:300])
        except Exception:
            logging.getLogger(__name__).exception("could not record the login for the integrity review")
        return Response({"token": token.key, "user": user_payload(authed)})


@api_view(["POST"])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"ok": True})


class ChangePasswordView(APIView):
    allow_forced_password_change = True

    def post(self, request):
        u = request.user
        old, new = request.data.get("old_password", ""), request.data.get("new_password", "")
        if not u.check_password(old):
            return Response({"detail": "Your current password is not correct."}, status=400)
        if new == old:
            return Response({"detail": "Please choose a different password."}, status=400)
        try:  # teachers and admins follow the strong staff rule (AUTH-07) here too, not only when an administrator sets the password
            (validate_password if u.is_student else validate_staff_password)(new, u)
        except DjangoValidationError as e:
            return Response({"detail": " ".join(e.messages)}, status=400)
        u.set_password(new)
        u.must_change_password = False
        u.save()
        audit(u, "password.change", u.pk)
        notify_password_changed(u)  # NOT-01
        return Response({"ok": True})


class MeView(APIView):
    allow_forced_password_change = True

    def get(self, request):
        return Response(user_payload(request.user))

    def patch(self, request):
        """Language, theme and accessibility choices are remembered per user (ACC-01, ACC-02, ACC-06)."""
        u, d = request.user, request.data
        for f, allowed in (("language", {"en", "sw"}), ("theme", THEMES)):
            if f in d:
                if d[f] not in allowed:  # an unknown choice is refused, not silently ignored
                    raise ValidationError({f: "Choose one of: " + ", ".join(sorted(allowed)) + "."})
                setattr(u, f, d[f])
        if "text_size" in d:
            try:
                u.text_size = max(100, min(200, int(d["text_size"])))
            except (TypeError, ValueError):
                raise ValidationError({"text_size": "Choose a size from 100 to 200 percent."})
        if "line_spacing" in d:
            try:
                u.line_spacing = max(1.0, min(2.5, float(d["line_spacing"])))
            except (TypeError, ValueError):
                raise ValidationError({"line_spacing": "Choose a line spacing from 1.0 to 2.5."})
        for f in ("dyslexia_font", "reduce_motion", "read_aloud"):
            if f in d:
                setattr(u, f, d[f] if isinstance(d[f], bool) else str(d[f]).lower() in ("1", "true", "yes", "on"))
        u.save(update_fields=["language", "theme", "text_size", "line_spacing", "dyslexia_font",
                              "reduce_motion", "read_aloud"])
        return Response(user_payload(u))


class StudentSerializer(serializers.ModelSerializer):
    school_class_name = serializers.SerializerMethodField()
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "index_number", "school_class",
                  "school_class_name", "is_active", "is_archived", "graduated", "is_locked", "locked_until"]
        read_only_fields = ["username", "is_archived", "graduated", "is_locked", "locked_until"]

    def get_school_class_name(self, o):
        return str(o.school_class) if o.school_class else None

    def get_is_locked(self, o):
        return is_locked(o)


class StudentViewSet(viewsets.ModelViewSet):
    """Admin student management (ADM-01). 'Delete' archives; only a super admin purges."""

    permission_classes = [IsAdminRole]
    serializer_class = StudentSerializer

    def get_queryset(self):
        qs = User.objects.filter(role=User.Role.STUDENT).select_related("school_class").order_by("school_class", "last_name")
        p = self.request.query_params
        if p.get("archived") == "1":
            qs = qs.filter(is_archived=True)
        elif self.action == "list":
            qs = qs.filter(is_archived=False)
        if p.get("graduated") == "1":
            qs = qs.filter(graduated=True)
        if p.get("active") in ("0", "1"):
            qs = qs.filter(is_active=p["active"] == "1")
        if p.get("class"):
            qs = qs.filter(school_class_id=p["class"])
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(username__icontains=q) | Q(index_number__icontains=q))
        return qs

    def perform_create(self, serializer):
        from .services import make_username
        from django.contrib.auth.hashers import make_password

        d = serializer.validated_data
        taken = set(User.objects.values_list("username", flat=True))
        obj = serializer.save(username=make_username(d["first_name"], taken), role=User.Role.STUDENT, must_change_password=True)
        temp_password.issue(obj)  # random starting password, printed on the credentials sheet (never the index number)
        audit(self.request.user, "student.create", obj.pk)

    def perform_update(self, serializer):
        obj = serializer.save()
        audit(self.request.user, "student.edit", obj.pk)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if request.query_params.get("permanent") == "1":
            if not IsSuperAdmin().has_permission(request, self):
                return Response({"detail": "Only a Super Admin can delete permanently."}, status=403)
            audit(request.user, "student.purge", obj.pk)
            obj.delete()
            return Response(status=204)
        obj.is_archived, obj.is_active = True, False
        obj.save(update_fields=["is_archived", "is_active"])
        Token.objects.filter(user=obj).delete()
        audit(request.user, "student.archive", obj.pk)
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        obj = User.objects.get(pk=pk, role=User.Role.STUDENT)
        obj.is_archived, obj.is_active = False, True
        obj.save(update_fields=["is_archived", "is_active"])
        audit(request.user, "student.restore", obj.pk)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        """Lift the lock-out after too many wrong passwords. The password stays as it is."""
        obj = self.get_object()
        unlock_user(obj)
        audit(request.user, "student.unlock", obj.pk)
        return Response({"ok": True, "detail": "Unlocked. She can try to log in again now."})

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        obj = self.get_object()
        code = temp_password.issue(obj)
        Token.objects.filter(user=obj).delete()
        audit(request.user, "password.reset", obj.pk)
        notify_password_changed(obj, by_admin=True)
        # shown once here and on the credentials sheet; she must choose her own password at the first login
        return Response({"ok": True, "temporary_password": code,
                         "detail": "A new starting password was issued (it is on the credentials sheet); she must choose a new one."})

    def _set_state(self, request, pk, label, **fields):
        obj = self.get_object()
        for k, v in fields.items():
            setattr(obj, k, v)
        obj.save(update_fields=list(fields))
        if fields.get("is_active") is False:
            Token.objects.filter(user=obj).delete()  # she is logged out straight away
        audit(request.user, f"student.{label}", obj.pk)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        return self._set_state(request, pk, "deactivate", is_active=False)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._set_state(request, pk, "activate", is_active=True, graduated=False)

    @action(detail=True, methods=["post"])
    def graduate(self, request, pk=None):
        return self._set_state(request, pk, "graduate", is_active=False, graduated=True)

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """ADM-01: move to another class."""
        klass = SchoolClass.objects.filter(pk=request.data.get("school_class")).first()
        if not klass:
            raise ValidationError({"school_class": "Choose a class."})
        return self._set_state(request, pk, "move", school_class=klass)


def _flag(v, default):
    """A form or query value such as "1", "0", "true", "false"."""
    if v in (None, ""):
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _chosen_class(data):
    """The class picked on screen: ("id", SchoolClass) | ("new", (name, stream)) | None. Raises ValidationError for a bad choice."""
    cid = (data.get("class") or "").strip() if isinstance(data.get("class"), str) else data.get("class")
    if cid:
        klass = SchoolClass.objects.filter(pk=cid).first() if str(cid).isdigit() else None
        if not klass:
            raise ValidationError({"class": "That class no longer exists. Choose another."})
        return "id", klass
    name = (data.get("class_name") or "").strip()
    if name:
        if not re.search(r"[0-4]", name):
            raise ValidationError({"class_name": "The class name needs a form number from 0 to 4, for example Form 2."})
        return "new", (re.sub(r"\s+", " ", name)[:40], (data.get("class_stream") or "").strip().upper()[:20])
    return None


@api_view(["GET"])
@permission_classes([IsAdminRole])
def upload_options(request):
    """Everything the upload screen needs: the school's classes with how many students each already has."""
    counts = dict(User.objects.filter(role=User.Role.STUDENT, is_archived=False, school_class__isnull=False)
                  .values_list("school_class").annotate(n=Count("pk")).values_list("school_class", "n"))
    return Response({"classes": [{"id": c.pk, "label": str(c), "form_level": c.form_level, "students": counts.get(c.pk, 0)} for c in SchoolClass.objects.all()]})


@api_view(["GET"])
@permission_classes([IsAdminRole])
def upload_template(request):
    """?class=<id> leaves out the class and stream columns (the class is chosen on screen); ?parents=0|1|2 how many parents;
    ?format=csv|xlsx (the Excel version has a class drop-down and a "How to fill" sheet). With no options: the classic CSV."""
    p = request.query_params
    chosen = _chosen_class(p)
    cols = ["first name", "last name", "index number"]
    if not chosen:
        cols += ["class or form", "stream"]
    n_parents = p.get("parents", "2")
    if n_parents not in ("0", "1", "2"):
        n_parents = "2"
    cols += TEMPLATE_COLUMNS[5:8][: 3 if n_parents != "0" else 0] + (TEMPLATE_COLUMNS[8:11] if n_parents == "2" else [])
    head = [c.title() for c in cols]
    label = (str(chosen[1]) if chosen and chosen[0] == "id" else " ".join(x for x in chosen[1] if x) if chosen else "").strip()
    stub = "students_template" + (f"_{re.sub(r'[^A-Za-z0-9]+', '_', label).strip('_')}" if label else "")
    if p.get("format") != "xlsx":
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="{stub}.csv"'
        csv.writer(resp).writerow(head)
        return resp
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = Workbook()
    ws = wb.active
    ws.title = "Students"
    ws.append(head)
    for i, h in enumerate(head, start=1):
        c = ws.cell(row=1, column=i)
        c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="0B6B4F")
        c.alignment = Alignment(vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = max(16, len(h) + 6)
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 24
    for col_name in ("index number", "parent phone", "parent 2 phone"):  # text, so a leading zero or a long number is kept as typed
        if col_name in cols:
            L = get_column_letter(cols.index(col_name) + 1)
            for r in range(2, 502):
                ws[f"{L}{r}"].number_format = "@"
    classes = list(SchoolClass.objects.all())
    names = wb.create_sheet("Classes")
    names.append(["Class (form)", "Stream"])
    for c in classes:
        names.append([c.name, c.stream])
    names.column_dimensions["A"].width, names.column_dimensions["B"].width = 20, 12
    if "class or form" in cols and classes:
        L = get_column_letter(cols.index("class or form") + 1)
        dv = DataValidation(type="list", formula1=f"=Classes!$A$2:$A${len(classes) + 1}", allow_blank=True, showErrorMessage=False)
        ws.add_data_validation(dv)
        dv.add(f"{L}2:{L}501")
    how = wb.create_sheet("How to fill")
    lines = ["How to fill this sheet", "",
             "1. One student per row on the Students sheet, starting under the green heading row.",
             "2. First name, last name and index number are required." + ("" if chosen else " So is the class or form (for example Form 2)."),
             f"3. All students go into {label or 'the class written on each row'}." if chosen else "3. Pick the class from the drop-down, or type it. Add a stream (A, B, …) if the class has streams.",
             "4. Leave a cell empty if you do not have the answer; only the required ones must be filled.",
             "5. Parent columns are optional. Phone numbers are Tanzanian mobiles, such as 0712 345 678.",
             "6. Save the file and upload it on the Students tab. You will see a check before anything is created."]
    for i, t in enumerate(lines, start=1):
        how.cell(row=i, column=1, value=t)
    how["A1"].font = Font(bold=True, size=14)
    how.column_dimensions["A"].width = 110
    buf = io.BytesIO()
    wb.save(buf)
    resp = HttpResponse(buf.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp["Content-Disposition"] = f'attachment; filename="{stub}.xlsx"'
    return resp


@api_view(["POST"])
@permission_classes([IsAdminRole])
def bulk_validate(request):
    """Step 1: validate only. Nothing is created yet (AUTH-03).
    Form fields besides the file: class (id) or class_name + class_stream, create_classes, existing (reject|skip), tidy, username_style."""
    f = request.FILES.get("file")
    if not f:
        return Response({"detail": "Please choose a file."}, status=400)
    d = request.data
    chosen = _chosen_class(d)
    existing = d.get("existing") if d.get("existing") in ("reject", "skip") else "reject"
    style = d.get("username_style") if d.get("username_style") in ("first", "first.last") else "first"
    fixed = None
    if chosen:
        fixed = (chosen[1].name, chosen[1].stream) if chosen[0] == "id" else chosen[1]
    opts = {"fixed": fixed, "create_classes": _flag(d.get("create_classes"), True), "existing": existing,
            "tidy": _flag(d.get("tidy"), False), "username_style": style}
    try:
        rows = parse_upload(f, class_fixed=bool(fixed))
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)
    except Exception:
        return Response({"detail": "We could not read that file. Please use the template."}, status=400)
    try:
        clean, report = validate_rows(rows, opts)
    except ValueError as e:  # e.g. parents named in the file but GUARDIAN_KEY is not set
        return Response({"detail": str(e)}, status=400)
    batch = BulkUploadBatch.objects.create(created_by=request.user, rows=clean, report=report)
    return Response({"batch_id": batch.pk, **report})


@api_view(["POST"])
@permission_classes([IsAdminRole])
def bulk_confirm(request, batch_id):
    """Step 2: admin confirms, accounts are created (AUTH-04, AUTH-05)."""
    try:
        batch = BulkUploadBatch.objects.get(pk=batch_id, created_by=request.user)
    except BulkUploadBatch.DoesNotExist:
        return Response({"detail": "Upload not found."}, status=404)
    if batch.status != BulkUploadBatch.PENDING:
        return Response({"detail": "This upload was already confirmed."}, status=409)
    if batch.report.get("invalid_rows") and not request.data.get("skip_invalid"):
        return Response({"detail": "Some rows are invalid. Fix the file, or confirm with skip_invalid to create only the valid rows."}, status=400)
    try:
        ids = create_students(batch, request.user)
    except Exception as e:  # nothing was saved (the whole step is one transaction); say why instead of a blank "something went wrong"
        logging.getLogger(__name__).exception("bulk upload %s could not be confirmed", batch.pk)
        return Response({"detail": f"The accounts could not be created, and nothing was saved. Reason: {type(e).__name__}: {str(e)[:300]}. "
                                   "Check the file for very long cells or odd characters, then upload it again."}, status=400)
    out = {"created": len(ids), "credentials_url": f"/api/students/bulk-upload/{batch.pk}/credentials/"}
    if batch.report.get("parents_result"):
        out["parents"] = batch.report["parents_result"]
    return Response(out)


def _credentials_response(users, stub, kind):
    """AUTH-06: printable sheet (PDF, one page group per class) or CSV. Only students who still
    have their starting password are listed, so the sheet never exposes a chosen password."""
    users = list(users)
    kind = "csv" if kind == "csv" else "pdf"
    if kind == "csv":
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="{stub}.csv"'
        w = csv.writer(resp)
        w.writerow(["Class", "Name", "Username", "Starting password"])
        for u in users:
            w.writerow([reports.csv_safe(str(u.school_class)), reports.csv_safe(f"{u.first_name} {u.last_name}"),
                        u.username, reports.csv_safe(temp_password.password_for(u) or "")])
        return resp
    groups = {}
    for u in users:
        groups.setdefault(str(u.school_class) if u.school_class else "No class", []).append(
            (f"{u.first_name} {u.last_name}", u.username, temp_password.password_for(u) or "-"))
    pdf = reports.credentials_pdf(SchoolSettings.load().school_name, list(groups.items()))
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{stub}.pdf"'
    return resp


def _ordered(qs):
    return qs.select_related("school_class").order_by("school_class__form_level", "school_class__name",
                                                      "school_class__stream", "last_name", "first_name")


@api_view(["GET"])
@permission_classes([IsAdminRole])
def bulk_credentials(request, batch_id):
    """Right after an upload: ?file=pdf (default) or ?file=csv."""
    try:
        batch = BulkUploadBatch.objects.get(pk=batch_id, created_by=request.user)
    except BulkUploadBatch.DoesNotExist:
        return Response({"detail": "Upload not found."}, status=404)
    users = _ordered(User.objects.filter(pk__in=batch.created_user_ids, must_change_password=True, temp_issued_at__isnull=False))
    audit(request.user, "credentials.download", batch.pk)
    return _credentials_response(users, f"credentials_{batch.pk}", request.query_params.get("file"))


@api_view(["GET"])
@permission_classes([IsAdminRole])
def class_credentials(request):
    """Sheet for one class at any time: ?class=<id>&file=pdf|csv (students who have not yet changed their password)."""
    users = User.objects.filter(role=User.Role.STUDENT, must_change_password=True, is_archived=False, is_active=True,
                                temp_issued_at__isnull=False)  # students whose password was set by the parents' SMS are not on the sheet
    if request.query_params.get("class"):
        users = users.filter(school_class_id=request.query_params["class"])
    audit(request.user, "credentials.download", request.query_params.get("class", "all"))
    return _credentials_response(_ordered(users), "credentials", request.query_params.get("file"))


@api_view(["POST"])
@permission_classes([IsAdminRole])
def students_bulk_action(request):
    """ADM-02: change_class | reset_passwords | unlock | deactivate | graduate for many students at once."""
    ids = request.data.get("ids")
    action_name = request.data.get("action")
    if not isinstance(ids, list) or not ids:
        raise ValidationError({"ids": "Choose at least one student."})
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        raise ValidationError({"ids": "Student ids must be numbers."})
    qs = User.objects.filter(role=User.Role.STUDENT, pk__in=ids, is_archived=False)
    n = qs.count()
    if action_name == "change_class":
        klass = SchoolClass.objects.filter(pk=request.data.get("school_class")).first()
        if not klass:
            raise ValidationError({"school_class": "Choose a class."})
        qs.update(school_class=klass)
        audit(request.user, "students.bulk.change_class", klass.pk, count=n)
    elif action_name == "reset_passwords":
        users = list(qs)
        for u in users:  # the light starting-password hasher keeps 500 resets fast (see settings)
            temp_password.issue(u, save=False)
        User.objects.bulk_update(users, ["password", "must_change_password", "failed_logins", "locked_until", "temp_serial", "temp_issued_at"])
        Token.objects.filter(user__in=users).delete()
        audit(request.user, "students.bulk.reset_passwords", "", count=n)
    elif action_name == "unlock":
        qs.update(failed_logins=0, locked_until=None)  # passwords and sessions are left alone
        audit(request.user, "students.bulk.unlock", "", count=n)
    elif action_name in ("deactivate", "graduate"):
        fields = {"is_active": False}
        if action_name == "graduate":
            fields["graduated"] = True
        Token.objects.filter(user__in=list(qs)).delete()
        qs.update(**fields)
        audit(request.user, f"students.bulk.{action_name}", "", count=n)
    else:
        raise ValidationError({"action": "Choose change_class, reset_passwords, unlock, deactivate or graduate."})
    return Response({"ok": True, "affected": n})


# ------------------------------------------------------------ teacher and admin accounts (ADM-03, AUTH-07)

class StaffSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    assignments = serializers.SerializerMethodField()
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "is_active", "password", "assignments",
                  "is_locked", "locked_until"]
        read_only_fields = ["is_locked", "locked_until"]

    def get_is_locked(self, o):
        return is_locked(o)

    def get_assignments(self, o):
        return [{"id": a.pk, "subject": a.subject_id, "subject_name": a.subject.name, "school_class": a.school_class_id}
                for a in o.assignments.all()]


class StaffAccountViewSet(viewsets.ModelViewSet):
    """Base for teacher and admin accounts. Created by an admin with a strong starting password;
    the person must change it at first login."""

    permission_classes = [IsAdminRole]
    serializer_class = StaffSerializer
    role = User.Role.TEACHER
    label = "teacher"

    def get_queryset(self):
        p = self.request.query_params
        qs = User.objects.filter(role=self.role).prefetch_related("assignments__subject").order_by("last_name", "username")
        for word in (p.get("q") or "").split():  # every word must match: "mary k" finds Mary Kimaro
            qs = qs.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(username__icontains=word) | Q(email__icontains=word))
        if p.get("active") in ("0", "1"):
            qs = qs.filter(is_active=p["active"] == "1")
        if self.role == User.Role.TEACHER and (p.get("subject", "").isdigit() or p.get("class", "").isdigit()):
            # one assignment must satisfy both: "English in Form 1 B", not English somewhere and Form 1 B for another subject
            a = TeacherAssignment.objects.filter(teacher=OuterRef("pk"))
            if p.get("subject", "").isdigit():
                a = a.filter(subject_id=int(p["subject"]))
            if p.get("class", "").isdigit():  # teaches that class, or teaches the subject in every class
                a = a.filter(Q(school_class_id=int(p["class"])) | Q(school_class__isnull=True))
            qs = qs.filter(Exists(a))
        return qs

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        pw = data.pop("password", None)
        if not pw:
            raise ValidationError({"password": "Please set a starting password."})
        user = User(role=self.role, must_change_password=True, **data)
        try:
            validate_staff_password(pw, user)
        except DjangoValidationError as e:
            raise ValidationError({"password": e.messages})
        user.set_password(pw)
        user.save()
        audit(request.user, f"{self.label}.create", user.pk)
        return Response(self.get_serializer(user).data, status=201)

    def perform_update(self, serializer):
        serializer.validated_data.pop("password", None)  # passwords change only through reset-password
        obj = serializer.save()
        if not obj.is_active:
            Token.objects.filter(user=obj).delete()
        audit(self.request.user, f"{self.label}.edit", obj.pk)

    def destroy(self, request, *args, **kwargs):
        """Teachers are deactivated (their questions and exams stay)."""
        obj = self.get_object()
        obj.is_active = False
        obj.save(update_fields=["is_active"])
        Token.objects.filter(user=obj).delete()
        audit(request.user, f"{self.label}.deactivate", obj.pk)
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        obj = self.get_object()
        obj.is_active = True
        obj.save(update_fields=["is_active"])
        audit(request.user, f"{self.label}.activate", obj.pk)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        """Lift a lock-out after too many wrong passwords, keeping the password as it is."""
        obj = self.get_object()
        unlock_user(obj)
        audit(request.user, f"{self.label}.unlock", obj.pk)
        return Response({"ok": True})

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """AUTH-07. Send new_password, or leave it out to get a random temporary one (shown once)."""
        obj = self.get_object()
        given = request.data.get("new_password")
        pw = given or generate_password()
        try:
            validate_staff_password(pw, obj)
        except DjangoValidationError as e:
            raise ValidationError({"new_password": e.messages})
        obj.set_password(pw)
        obj.must_change_password, obj.failed_logins, obj.locked_until = True, 0, None
        obj.save()
        Token.objects.filter(user=obj).delete()
        audit(request.user, "password.reset", obj.pk)
        notify_password_changed(obj, by_admin=True)
        return Response({"ok": True, **({} if given else {"temporary_password": pw})})


class TeacherViewSet(StaffAccountViewSet):
    pass


class AdminAccountViewSet(StaffAccountViewSet):
    """Only a Super Admin creates or removes Admin accounts (section 2 of the SRS)."""

    permission_classes = [IsSuperAdmin]
    role = User.Role.ADMIN
    label = "admin"

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.pk == request.user.pk:
            raise ValidationError({"detail": "You cannot remove your own account."})
        audit(request.user, "admin.remove", obj.pk, username=obj.username)
        obj.delete()
        return Response(status=204)
