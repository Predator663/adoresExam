"""Locked accounts (students, teachers, admins): see them, clear their wrong-attempt counter, or give them a new password.

SUPER ADMIN ONLY. An account is locked by the login (accounts/views.py LoginView) after MAX_FAILED wrong passwords in a row, for
LOCK_MINUTES. Two columns on the user hold that state: `locked_until` (a time in the future = locked now) and `failed_logins`
(wrong tries since the last success or lock). This module only reads and clears those two columns; the login rules are untouched.

  GET  /api/lockouts/                     ?role=student|teacher|admin &status=locked|warning|all &q= &class= &page= &page_size=
                                          (always paged, with a summary for that role and the counts of every role)
  POST /api/lockouts/<id>/reset-attempts/ clears the counter AND the lock (the student can log in at once)
  POST /api/lockouts/<id>/reset-password/ new random password (shown once), clears the lock, ends their sessions
  POST /api/lockouts/bulk/                {ids: [...], action: "reset_attempts" | "reset_passwords"}   (max 200 at a time;
                                          reset_passwords is for students only: staff passwords are reset one by one)
Super Admin accounts are never listed or changed here, and nobody can touch their own account here.

Every change is written to the audit log with the Super Admin's name. Rows are locked (SELECT ... FOR UPDATE) while they change.
"""
import logging
import math

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from core.models import audit
from core.pagination import envelope, page_params
from notifications.services import notify_password_changed
from . import temp_password
from .models import User
from .permissions import IsSuperAdmin
from .services import generate_password, validate_staff_password
from .views import LOCK_MINUTES, MAX_FAILED

log = logging.getLogger(__name__)

MAX_BULK = 200
STATUSES = ("locked", "warning", "all")
CLEAR_FIELDS = ["failed_logins", "locked_until"]
RESET_FIELDS = ["password", "must_change_password", "failed_logins", "locked_until", "temp_serial", "temp_issued_at"]


ROLES = (User.Role.STUDENT, User.Role.TEACHER, User.Role.ADMIN)  # a Super Admin is never listed or changed here


def _people(role=None):
    """Accounts that can be touched here. Archived (deleted) students are left alone."""
    return User.objects.filter(role__in=[role] if role else ROLES, is_archived=False)


def _role_arg(value):
    role = value or User.Role.STUDENT
    if role not in ROLES:
        raise ValidationError({"role": "Choose student, teacher or admin."})
    return role


def _is_locked(u, now):
    return bool(u.locked_until and u.locked_until > now)


def _row(u, now):
    locked = _is_locked(u, now)
    return {
        "id": u.pk, "username": u.username, "first_name": u.first_name, "last_name": u.last_name,
        "role": u.role, "index_number": u.index_number, "class_name": str(u.school_class) if u.school_class_id else None,
        "is_active": u.is_active, "locked": locked,
        "locked_until": u.locked_until.isoformat() if locked else None,
        "seconds_left": max(0, math.ceil((u.locked_until - now).total_seconds())) if locked else 0,
        "failed_logins": u.failed_logins, "attempts_left": max(0, MAX_FAILED - u.failed_logins),
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "must_change_password": u.must_change_password,
    }


def _summary(now, role=User.Role.STUDENT):
    """Counts for `role` (locked, warning) plus the same counts for every role, so each tab can show its own badge."""
    out = {}
    for r in ROLES:
        c = _people(r).aggregate(
            locked=Count("pk", filter=Q(locked_until__gt=now)),
            warning=Count("pk", filter=Q(failed_logins__gt=0) & (Q(locked_until__isnull=True) | Q(locked_until__lte=now))),
        )
        out[r] = {"locked": c["locked"], "warning": c["warning"]}
    return {**out[role], "role": role, "roles": out, "max_attempts": MAX_FAILED, "lock_minutes": LOCK_MINUTES}


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def lockout_list(request):
    p = request.query_params
    status = p.get("status", "locked")
    if status not in STATUSES:
        raise ValidationError({"status": "Choose locked, warning or all."})
    role = _role_arg(p.get("role"))
    now = timezone.now()
    locked_q = Q(locked_until__gt=now)
    warning_q = Q(failed_logins__gt=0) & (Q(locked_until__isnull=True) | Q(locked_until__lte=now))
    qs = _people(role).select_related("school_class")
    qs = qs.filter(locked_q if status == "locked" else warning_q if status == "warning" else (locked_q | warning_q))
    if p.get("class", "").isdigit():
        qs = qs.filter(school_class_id=int(p["class"]))
    for word in (p.get("q") or "").split()[:6]:  # every word must match: "amina k" finds Amina Kimaro
        qs = qs.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(username__icontains=word) | Q(index_number__icontains=word))
    qs = qs.order_by(F("locked_until").desc(nulls_last=True), "-failed_logins", "last_name", "first_name", "pk")
    page, size = page_params(request, default=20)
    count = qs.count()
    pages = max(1, -(-count // size))
    page = min(page, pages)
    rows = [_row(u, now) for u in qs[(page - 1) * size: page * size]]
    return Response(envelope(count, page, size, rows, summary=_summary(now, role), server_time=now.isoformat()))


def _person_for_update(request, pk):
    if pk == request.user.pk:
        raise ValidationError({"detail": "Use your own Settings to change your own account."})
    try:
        return _people().select_related("school_class").select_for_update(of=("self",)).get(pk=pk)
    except User.DoesNotExist:
        raise NotFound("This account was not found (it may have been archived).")


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def reset_attempts(request, pk):
    """Clear the wrong-attempt counter and any lock. Safe to press twice."""
    now = timezone.now()
    with transaction.atomic():
        u = _person_for_update(request, pk)
        was_locked, tries = _is_locked(u, now), u.failed_logins
        changed = was_locked or tries > 0 or u.locked_until is not None
        if changed:
            u.failed_logins, u.locked_until = 0, None
            u.save(update_fields=CLEAR_FIELDS)
            audit(request.user, "login.unlock", u.pk, username=u.username, role=u.role, was_locked=was_locked, attempts_cleared=tries)
    return Response({"ok": True, "changed": changed, "was_locked": was_locked, "attempts_cleared": tries, "student": _row(u, now)})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def reset_password(request, pk):
    """A student gets a new starting password (the kind the credentials sheet prints); a teacher or admin gets a strong random one
    (the same rule as Staff > Reset password). Either way the lock is cleared, sessions end and a new password must be chosen."""
    now = timezone.now()
    with transaction.atomic():
        u = _person_for_update(request, pk)
        if u.role == User.Role.STUDENT:
            code = temp_password.issue(u)  # sets must_change_password and clears failed_logins / locked_until
        else:
            code = generate_password()
            try:
                validate_staff_password(code, u)
            except DjangoValidationError:  # a generated password that fails the rules is a bug: refuse, never save it
                log.exception("generated staff password was refused for %s", u.username)
                raise ValidationError({"detail": "Could not make a safe password. Please try again."})
            u.set_password(code)
            u.must_change_password, u.failed_logins, u.locked_until = True, 0, None
            u.save(update_fields=["password", "must_change_password", "failed_logins", "locked_until"])
        Token.objects.filter(user=u).delete()
        audit(request.user, "password.reset", u.pk, username=u.username, role=u.role, source="locked_accounts")
    try:  # the reset is already saved; a failing notification must not hide the new password
        notify_password_changed(u, by_admin=True)
    except Exception:
        log.exception("could not notify %s about the password reset", u.username)
    return Response({"ok": True, "temporary_password": code, "student": _row(u, now),
                     "detail": "A new password was issued. It must be changed at the next login."})


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def lockout_bulk(request):
    ids, action = request.data.get("ids"), request.data.get("action")
    if not isinstance(ids, list) or not ids:
        raise ValidationError({"ids": "Choose at least one student."})
    if len(ids) > MAX_BULK:
        raise ValidationError({"ids": f"Choose at most {MAX_BULK} students at a time."})
    try:
        ids = sorted({int(i) for i in ids})
    except (TypeError, ValueError):
        raise ValidationError({"ids": "Student ids must be numbers."})
    if action not in ("reset_attempts", "reset_passwords"):
        raise ValidationError({"action": "Choose reset_attempts or reset_passwords."})
    role = _role_arg(request.data.get("role"))  # only picks which counts come back; checked before anything changes
    now = timezone.now()
    out = {"ok": True, "requested": len(ids)}
    ids = [i for i in ids if i != request.user.pk]  # never your own account
    with transaction.atomic():
        pool = _people() if action == "reset_attempts" else _people(User.Role.STUDENT)  # staff passwords are reset one by one
        if action == "reset_passwords" and _people().filter(pk__in=ids).exclude(role=User.Role.STUDENT).exists():
            raise ValidationError({"ids": "New passwords for teachers and admins are given one at a time. Select students only."})
        users = list(pool.select_related("school_class").select_for_update(of=("self",)).filter(pk__in=ids)
                     .order_by("school_class__form_level", "school_class__name", "school_class__stream", "last_name", "first_name", "pk"))
        names = [u.username for u in users][:MAX_BULK]
        if action == "reset_attempts":
            todo = [u for u in users if _is_locked(u, now) or u.failed_logins > 0 or u.locked_until is not None]
            for u in todo:
                u.failed_logins, u.locked_until = 0, None
            if todo:
                User.objects.bulk_update(todo, CLEAR_FIELDS)
                audit(request.user, "login.unlock.bulk", "", count=len(todo), usernames=[u.username for u in todo], roles=sorted({u.role for u in todo}))
            out["affected"] = len(todo)
        else:
            codes = [(u, temp_password.issue(u, save=False)) for u in users]
            if users:
                User.objects.bulk_update(users, RESET_FIELDS)
                Token.objects.filter(user__in=users).delete()
                audit(request.user, "students.bulk.reset_passwords", "", count=len(users), usernames=names, source="locked_accounts")
            out["affected"] = len(users)
            out["credentials"] = [{"id": u.pk, "name": f"{u.first_name} {u.last_name}".strip(), "username": u.username,
                                   "class_name": str(u.school_class) if u.school_class_id else "", "temporary_password": c} for u, c in codes]
    out["skipped"] = out["requested"] - len(users)  # ids that are not (or no longer) accounts this page may change
    out["summary"] = _summary(now, role)
    return Response(out)
