"""Login activity: how often students use the system (administrators only).

Built from the "login" entries (and "login.failed" for wrong passwords) the audit log keeps, so nothing new is stored and the history
reaches back to the day the audit log began. Days are counted in the school's own time zone (Africa/Dar_es_Salaam).
A login is a sign-in, not time spent: a student who stays signed in on her phone for days counts once, on the day she signed in."""
import zoneinfo
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Count, Max
from django.db.models.functions import ExtractHour, TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdminRole
from core.models import AuditLog
from core.pagination import paginate

TZ = zoneinfo.ZoneInfo(settings.TIME_ZONE)
MAX_DAYS = 365
BANDS = [("Never", 0, 0), ("1 day", 1, 1), ("2 to 3 days", 2, 3), ("4 to 7 days", 4, 7), ("8 days or more", 8, None)]


def _window(request):
    """(days, first local date, today, start datetime) from ?days=N (1..365, default 30). The window includes today."""
    try:
        days = int(request.query_params.get("days", 30))
    except ValueError:
        raise ValidationError({"detail": "days must be a number."})
    if not 1 <= days <= MAX_DAYS:
        raise ValidationError({"detail": f"days must be between 1 and {MAX_DAYS}."})
    today = timezone.now().astimezone(TZ).date()
    first = today - timedelta(days=days - 1)
    return days, first, today, datetime.combine(first, time.min, tzinfo=TZ)


def _students(request):
    qs = User.objects.filter(role=User.Role.STUDENT, is_active=True, is_archived=False).select_related("school_class")
    cls = request.query_params.get("class")
    if cls:
        try:
            qs = qs.filter(school_class_id=int(cls))
        except ValueError:
            raise ValidationError({"detail": "class must be a number."})
    return qs


def _logins(student_ids, start):
    return AuditLog.objects.filter(action="login", actor_id__in=student_ids, created_at__gte=start).order_by()


def _failed(student_ids, start):
    """{student id: wrong-password tries} within the window. Wrong tries never lock an account; they are only counted here."""
    rows = AuditLog.objects.filter(action="login.failed", actor_id__in=student_ids, created_at__gte=start).order_by().values("actor_id").annotate(n=Count("id"))
    return {r["actor_id"]: r["n"] for r in rows}


def _failed_days(student_ids, start):
    """{date: wrong tries that day} for the whole selection."""
    rows = (AuditLog.objects.filter(action="login.failed", actor_id__in=student_ids, created_at__gte=start).order_by()
            .annotate(d=TruncDate("created_at", tzinfo=TZ)).values("d").annotate(n=Count("id")))
    return {r["d"]: r["n"] for r in rows}


def _per_day(student_ids, start):
    """{student id: {date: number of logins}} within the window."""
    out = {}
    rows = _logins(student_ids, start).annotate(d=TruncDate("created_at", tzinfo=TZ)).values("actor_id", "d").annotate(n=Count("id"))
    for r in rows:
        out.setdefault(r["actor_id"], {})[r["d"]] = r["n"]
    return out


def _hours(student_ids, start):
    got = {r["h"]: r["n"] for r in _logins(student_ids, start).annotate(h=ExtractHour("created_at", tzinfo=TZ)).values("h").annotate(n=Count("id"))}
    return [got.get(h, 0) for h in range(24)]


def _last_login(student_ids):
    rows = AuditLog.objects.filter(action="login", actor_id__in=student_ids).values("actor_id").annotate(m=Max("created_at")).order_by()
    return {r["actor_id"]: r["m"] for r in rows}


def _dates(first, today):
    return [first + timedelta(days=i) for i in range((today - first).days + 1)]


def _name(u):
    return f"{u.first_name} {u.last_name}".strip() or u.username


def _summary(per_day):
    """(logins, active days) of one student from her {date: logins}."""
    return sum(per_day.values()), len(per_day)


@api_view(["GET"])
@permission_classes([IsAdminRole])
def overview(request):
    """The whole school (or one class): logins per day, busiest hours and weekdays, and how many students use it how often."""
    days, first, today, start = _window(request)
    students = list(_students(request))
    ids = [s.pk for s in students]
    per = _per_day(ids, start)
    dates = _dates(first, today)
    daily = [{"date": d.isoformat(), "logins": sum(p.get(d, 0) for p in per.values()), "students": sum(1 for p in per.values() if d in p)} for d in dates]
    weekdays = [0] * 7
    for row in daily:
        weekdays[datetime.fromisoformat(row["date"]).weekday()] += row["logins"]
    active_days = {sid: len(p) for sid, p in per.items()}
    bands = []
    for label, lo, hi in BANDS:
        n = sum(1 for s in students if lo <= active_days.get(s.pk, 0) and (hi is None or active_days.get(s.pk, 0) <= hi))
        bands.append({"label": label, "count": n})
    used = len(active_days)
    failed_by_day = _failed_days(ids, start)
    failed = _failed(ids, start)
    for row in daily:
        row["failed"] = failed_by_day.get(datetime.fromisoformat(row["date"]).date(), 0)
    return Response({
        "failed_logins": sum(failed.values()), "students_with_failed": len(failed),
        "days": days, "from": first.isoformat(), "to": today.isoformat(), "students": len(students), "active_students": used,
        "never": len(students) - used, "logins": sum(r["logins"] for r in daily),
        "avg_days_used": round(sum(active_days.values()) / used, 1) if used else 0,
        "daily": daily, "hours": _hours(ids, start), "weekdays": weekdays, "bands": bands,
    })


@api_view(["GET"])
@permission_classes([IsAdminRole])
def student_list(request):
    """Every student with how often she logged in. ?sort=least (default) | most | recent | name, ?q= name or index, ?class=, paged with ?page=."""
    days, first, today, start = _window(request)
    students = list(_students(request))
    q = (request.query_params.get("q") or "").strip().lower()
    if q:
        students = [s for s in students if q in f"{_name(s)} {s.index_number}".lower()]
    ids = [s.pk for s in students]
    per, last, failed = _per_day(ids, start), _last_login(ids), _failed(ids, start)
    weeks = max(days / 7, 1)
    rows = []
    for s in students:
        logins, active = _summary(per.get(s.pk, {}))
        when = last.get(s.pk)
        rows.append({"id": s.pk, "name": _name(s), "index": s.index_number, "class": str(s.school_class) if s.school_class_id else "",
                     "logins": logins, "failed": failed.get(s.pk, 0), "active_days": active, "per_week": round(active / weeks, 1),
                     "last_login": when.isoformat() if when else None,
                     "days_since": (today - when.astimezone(TZ).date()).days if when else None})
    sort = request.query_params.get("sort", "least")
    key = {"least": lambda r: (r["active_days"], r["name"].lower()), "most": lambda r: (-r["active_days"], r["name"].lower()), "failed": lambda r: (-r["failed"], r["name"].lower()),
           "recent": lambda r: (r["days_since"] is None, r["days_since"] or 0, r["name"].lower()), "name": lambda r: r["name"].lower()}.get(sort)
    if not key:
        raise ValidationError({"detail": "sort must be least, most, recent, failed or name."})
    rows.sort(key=key)
    paged = paginate(request, rows)
    return Response(paged if paged is not None else rows)


@api_view(["GET"])
@permission_classes([IsAdminRole])
def student_detail(request, student_id):
    """One student: logins per day, the hours she usually signs in, longest stretch without a login."""
    days, first, today, start = _window(request)
    s = get_object_or_404(User.objects.select_related("school_class"), pk=student_id, role=User.Role.STUDENT)
    per = _per_day([s.pk], start).get(s.pk, {})
    fday = _failed_days([s.pk], start)
    daily = [{"date": d.isoformat(), "logins": per.get(d, 0), "failed": fday.get(d, 0)} for d in _dates(first, today)]
    gap = longest = 0
    for r in daily:
        gap = 0 if r["logins"] else gap + 1
        longest = max(longest, gap)
    when = _last_login([s.pk]).get(s.pk)
    logins, active = _summary(per)
    return Response({
        "id": s.pk, "name": _name(s), "index": s.index_number, "class": str(s.school_class) if s.school_class_id else "",
        "days": days, "from": first.isoformat(), "to": today.isoformat(), "logins": logins, "failed": sum(fday.values()), "active_days": active,
        "per_week": round(active / max(days / 7, 1), 1), "longest_gap_days": longest,
        "last_login": when.isoformat() if when else None, "days_since": (today - when.astimezone(TZ).date()).days if when else None,
        "daily": daily, "hours": _hours([s.pk], start),
    })
