"""Engagement and exam behaviour of each student (administrators only), built from data the system already keeps:
logins (audit log), screens opened and time on them (page visits), practice quizzes, exam attempts, answers, exits from the exam screen,
and what device and browser she uses. Nothing here is a verdict: every note is a pattern for a person to look at, never proof.

ENGAGEMENT SCORE (0-100) is explainable, four parts shown to the administrator:
  Regularity 35   days she used the app per week (logins and screen visits together; staying signed in on a phone counts), full marks at 4 days a week
  Time 20         minutes on screen per day she was active, full marks at 15 minutes
  Practice 25     practice quizzes finished per week, full marks at 3 a week
  Exams 20        exams she sat out of the exams she was meant to sit (left out, and the rest re-weighted, when no exam was held)
"""
from collections import Counter
from datetime import timedelta

from django.db.models import Count, Max, Min, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.permissions import IsAdminRole
from core.models import AuditLog, PageVisit, Presence
from core.pagination import paginate
from exams.models import Answer, Attempt, AttemptEvent, Exam, Result
from gamification.models import PracticeSession

from . import loginviews as L

W_REG, W_TIME, W_PRACTICE, W_EXAM = 35, 20, 25, 20
FULL_DAYS_PER_WEEK, FULL_MIN_PER_DAY, FULL_PRACTICE_PER_WEEK = 4.0, 15.0, 3.0
TIERS = [(70, "Highly engaged"), (45, "Engaged"), (20, "Occasional"), (1, "Rarely"), (0, "Not seen")]


def tier(score, seen):
    if not seen:
        return "Not seen"
    return next((label for lo, label in TIERS if score >= lo and lo > 0), "Rarely")


def score(active_days, days, minutes_per_active_day, practice_done, taken, eligible):
    """(total 0..100, parts {name: points}, weights used). Pure function, tested on its own."""
    weeks = max(days / 7.0, 1.0)
    parts = {"regularity": W_REG * min(1.0, (active_days / weeks) / FULL_DAYS_PER_WEEK),
             "time": W_TIME * min(1.0, minutes_per_active_day / FULL_MIN_PER_DAY) if active_days else 0.0,
             "practice": W_PRACTICE * min(1.0, (practice_done / weeks) / FULL_PRACTICE_PER_WEEK)}
    weights = {"regularity": W_REG, "time": W_TIME, "practice": W_PRACTICE}
    if eligible > 0:
        parts["exams"] = W_EXAM * min(1.0, taken / eligible)
        weights["exams"] = W_EXAM
    total = 100.0 * sum(parts.values()) / sum(weights.values())
    return round(total), {k: round(100.0 * v / weights[k]) for k, v in parts.items()}, weights


def trend(first_half_days, second_half_days, days):
    """'up' | 'down' | 'steady' | 'dropped' (was active in the first half, nearly gone in the second)."""
    if days < 14:
        return "steady"
    if first_half_days >= 3 and second_half_days <= 1:
        return "dropped"
    d = second_half_days - first_half_days
    return "up" if d >= 2 else "down" if d <= -2 else "steady"


# ------------------------------------------------------------------ gathering

def _visit_days(ids, start):
    """({student: {date}}, {student: seconds}, {student: set of screens})"""
    days, secs, screens = {}, {}, {}
    rows = (PageVisit.objects.filter(user_id__in=ids, entered_at__gte=start).order_by()
            .annotate(d=TruncDate("entered_at", tzinfo=L.TZ)).values("user_id", "d").annotate(s=Sum("seconds")))
    for r in rows:
        days.setdefault(r["user_id"], set()).add(r["d"])
        secs[r["user_id"]] = secs.get(r["user_id"], 0) + (r["s"] or 0)
    for r in PageVisit.objects.filter(user_id__in=ids, entered_at__gte=start).order_by().values("user_id", "screen").annotate(n=Count("id")):
        screens.setdefault(r["user_id"], set()).add(r["screen"])
    return days, secs, screens


def _practice(ids, start):
    rows = PracticeSession.objects.filter(user_id__in=ids, status="completed", started_at__gte=start).order_by().values("user_id").annotate(n=Count("id"))
    return {r["user_id"]: r["n"] for r in rows}


def _eligible(students, start, now):
    """{student: number of exams she was meant to sit, that began in the window}"""
    exams = list(Exam.objects.filter(start_at__gte=start, start_at__lte=now).exclude(status=Exam.DRAFT).prefetch_related("classes", "students"))
    by_class, by_student = {}, {}
    for e in exams:
        for c in e.classes.all():
            by_class.setdefault(c.pk, set()).add(e.pk)
        for s in e.students.all():
            by_student.setdefault(s.pk, set()).add(e.pk)
    return {s.pk: len(by_class.get(s.school_class_id, set()) | by_student.get(s.pk, set())) for s in students}


def behaviour(ids, start):
    """Per student: the exam attempts in the window and a summary. {student: {"attempts": [...], ...}}"""
    atts = list(Attempt.objects.filter(student_id__in=ids, started_at__gte=start).select_related("exam"))
    aid = [a.pk for a in atts]
    res = {r.attempt_id: r for r in Result.objects.filter(attempt_id__in=aid)}
    left = {r["attempt_id"]: r["n"] for r in AttemptEvent.objects.filter(attempt_id__in=aid, kind="left_screen").order_by().values("attempt_id").annotate(n=Count("id"))}
    ans = {r["attempt_id"]: r for r in Answer.objects.filter(attempt_id__in=aid).order_by().values("attempt_id")
           .annotate(n=Count("id"), skipped=Count("id", filter=_q(skipped=True)), timed=Count("id", filter=_q(timed_out=True)), first=Min("answered_at"), last=Max("answered_at"))}
    caps = Counter()
    for r in AuditLog.objects.filter(action="screen.capture", actor_id__in=ids, created_at__gte=start).order_by().values("actor_id").annotate(n=Count("id")):
        caps[r["actor_id"]] = r["n"]
    out = {}
    for a in atts:
        used = None
        r = res.get(a.pk)
        allowed = a.exam.duration_minutes * 60
        if r and allowed:
            used = round(min(1.5, r.time_taken_seconds / allowed), 3)
        elif a.submitted_at and allowed:
            used = round(min(1.5, (a.submitted_at - a.started_at).total_seconds() / allowed), 3)
        delay = None
        if a.exam.start_at:
            delay = max(0, round((a.started_at - a.exam.start_at).total_seconds() / 60, 1))
        an = ans.get(a.pk) or {}
        n = an.get("n") or 0
        per_answer = None
        if n >= 2 and an.get("first") and an.get("last"):
            per_answer = round((an["last"] - an["first"]).total_seconds() / (n - 1), 1)
        row = {"attempt_id": a.pk, "exam": a.exam.title, "exam_id": a.exam_id, "started_at": a.started_at, "status": a.status,
               "percent": round(r.percent, 1) if r else None, "time_used": used, "late_start_min": delay, "left_screen": left.get(a.pk, 0),
               "locked": bool(a.screen_lock), "answers": n, "skipped": an.get("skipped") or 0, "timed_out": an.get("timed") or 0, "sec_per_answer": per_answer,
               "auto_submitted": a.status == Attempt.AUTO_SUBMITTED}
        out.setdefault(a.student_id, {"attempts": []})["attempts"].append(row)
    for sid, v in out.items():
        v["attempts"].sort(key=lambda x: x["started_at"], reverse=True)
        v["summary"] = _summarise(v["attempts"])
        v["captures"] = caps.get(sid, 0)
    for sid in caps:
        out.setdefault(sid, {"attempts": [], "summary": _summarise([]), "captures": caps[sid]})
    return out


def _q(**kw):
    from django.db.models import Q
    return Q(**kw)


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 2) if xs else None


def _summarise(rows):
    n = len(rows)
    s = {"attempts": n, "avg_time_used": _avg([r["time_used"] for r in rows]), "avg_late_start_min": _avg([r["late_start_min"] for r in rows]),
         "left_screen_total": sum(r["left_screen"] for r in rows), "locked": sum(1 for r in rows if r["locked"]),
         "auto_submitted": sum(1 for r in rows if r["auto_submitted"]), "skipped": sum(r["skipped"] for r in rows),
         "answers": sum(r["answers"] for r in rows), "timed_out": sum(r["timed_out"] for r in rows),
         "fast_papers": sum(1 for r in rows if r["sec_per_answer"] is not None and r["answers"] >= 10 and r["sec_per_answer"] < 4)}
    return s


def notes(summary, eligible, taken, captures=0):
    """Plain-language patterns to look at. Never proof of anything."""
    out, n = [], summary["attempts"]
    if eligible and taken < eligible:
        out.append({"level": "info", "text": f"Sat {taken} of {eligible} exams she was meant to sit."})
    if n >= 2 and summary["avg_late_start_min"] is not None and summary["avg_late_start_min"] >= 15:
        out.append({"level": "info", "text": f"Usually starts late: about {round(summary['avg_late_start_min'])} minutes after the exam opens."})
    if n >= 2 and summary["avg_time_used"] is not None and summary["avg_time_used"] < 0.35:
        out.append({"level": "info", "text": f"Finishes very early: uses about {round(summary['avg_time_used'] * 100)}% of the time."})
    if n >= 2 and summary["auto_submitted"] / n >= 0.5:
        out.append({"level": "info", "text": "Often runs out of time (the exam closes before she submits)."})
    if n and summary["left_screen_total"] / n >= 3:
        out.append({"level": "warning", "text": f"Leaves the exam screen often: about {round(summary['left_screen_total'] / n, 1)} times per exam."})
    if summary["locked"]:
        out.append({"level": "warning", "text": f"Exam screen was locked {summary['locked']} time(s) for leaving it too often."})
    if summary["fast_papers"]:
        out.append({"level": "warning", "text": f"Answered {summary['fast_papers']} paper(s) very quickly (under 4 seconds per answer on average)."})
    if summary["answers"] >= 20 and summary["skipped"] / summary["answers"] >= 0.2:
        out.append({"level": "info", "text": f"Skips many questions ({round(100 * summary['skipped'] / summary['answers'])}%)."})
    if summary["answers"] >= 20 and summary["timed_out"] / summary["answers"] >= 0.15:
        out.append({"level": "info", "text": f"Many questions ran out of time ({round(100 * summary['timed_out'] / summary['answers'])}%)."})
    if captures:
        out.append({"level": "warning", "text": f"Tried to take a screenshot or print {captures} time(s) (the blur was on)."})
    return out


def devices_of(ids):
    """{student: last known device} from the app's heartbeat."""
    return {p.user_id: {"device_type": p.device_type or "unknown", "os": p.os or "Unknown", "browser": p.browser or "Unknown", "device": p.device,
                        "installed": p.standalone, "connection": p.connection, "last_seen": p.last_seen}
            for p in Presence.objects.filter(user_id__in=ids)}


# ------------------------------------------------------------------ views

def build(request, students, days, first, today, start):
    now = timezone.now()
    ids = [s.pk for s in students]
    per = L._per_day(ids, start)
    vdays, vsecs, vscreens = _visit_days(ids, start)
    practice, eligible = _practice(ids, start), _eligible(students, start, now)
    beh = behaviour(ids, start)
    dev = devices_of(ids)
    mid = first + timedelta(days=days // 2)
    rows = []
    for s in students:
        login_days = set(per.get(s.pk, {}))
        active = login_days | vdays.get(s.pk, set())
        n_active = len(active)
        mins = (vsecs.get(s.pk, 0) / 60.0 / n_active) if n_active else 0.0
        b = beh.get(s.pk) or {"attempts": [], "summary": _summarise([]), "captures": 0}
        taken = len({a["exam_id"] for a in b["attempts"]})
        el = eligible.get(s.pk, 0)
        sc, parts, _ = score(n_active, days, mins, practice.get(s.pk, 0), min(taken, el) if el else taken, el)
        seen = n_active > 0 or taken > 0 or practice.get(s.pk, 0) > 0
        first_half = sum(1 for d in active if d < mid)
        second_half = sum(1 for d in active if d >= mid)
        rows.append({"id": s.pk, "name": L._name(s), "index": s.index_number, "class": str(s.school_class) if s.school_class_id else "",
                     "score": sc if seen else 0, "tier": tier(sc, seen), "parts": parts, "trend": trend(first_half, second_half, days),
                     "active_days": n_active, "minutes_per_day": round(mins, 1), "minutes_total": round(vsecs.get(s.pk, 0) / 60),
                     "screens": len(vscreens.get(s.pk, ())), "practice": practice.get(s.pk, 0), "exams_taken": taken, "exams_eligible": el,
                     "behaviour": b["summary"], "notes": notes(b["summary"], el, taken, b["captures"]), "device": dev.get(s.pk)})
    return rows, beh, dev


@api_view(["GET"])
@permission_classes([IsAdminRole])
def engagement_list(request):
    """Every student with an engagement score and exam-behaviour notes. ?days= &class= &q= &sort=score|least|name|attention &tier= &page="""
    days, first, today, start = L._window(request)
    students = list(L._students(request))
    q = (request.query_params.get("q") or "").strip().lower()
    if q:
        students = [s for s in students if q in f"{L._name(s)} {s.index_number}".lower()]
    rows, _, _ = build(request, students, days, first, today, start)
    counts = Counter(r["tier"] for r in rows)
    want = request.query_params.get("tier")
    if want:
        rows = [r for r in rows if r["tier"] == want]
    sort = request.query_params.get("sort", "attention")
    warn = lambda r: sum(1 for n in r["notes"] if n["level"] == "warning")
    key = {"score": lambda r: (-r["score"], r["name"].lower()), "least": lambda r: (r["score"], r["name"].lower()), "name": lambda r: r["name"].lower(),
           "attention": lambda r: (0 if r["trend"] == "dropped" else 1, -warn(r), r["score"], r["name"].lower())}.get(sort)
    if not key:
        return Response({"detail": "sort must be attention, score, least or name."}, status=400)
    rows.sort(key=key)
    summary = {"tiers": [{"label": label, "count": counts.get(label, 0)} for _, label in TIERS], "dropped": sum(1 for r in rows if r["trend"] == "dropped"),
               "average": round(sum(r["score"] for r in rows) / len(rows)) if rows else 0, "students": len(rows)}
    paged = paginate(request, rows)
    body = paged if paged is not None else {"results": rows}
    body["summary"] = summary
    return Response(body)


@api_view(["GET"])
@permission_classes([IsAdminRole])
def engagement_student(request, student_id):
    from django.shortcuts import get_object_or_404
    from accounts.models import User
    days, first, today, start = L._window(request)
    s = get_object_or_404(User.objects.select_related("school_class"), pk=student_id, role=User.Role.STUDENT)
    rows, beh, dev = build(request, [s], days, first, today, start)
    r = rows[0]
    used = Counter()
    for log in AuditLog.objects.filter(action="login", actor_id=s.pk, created_at__gte=start).order_by().values_list("detail", flat=True):
        d = (log or {})
        used[(d.get("device_type") or "unknown", d.get("os") or "Unknown", d.get("browser") or "Unknown")] += 1
    return Response({**r, "attempts": (beh.get(s.pk) or {}).get("attempts", []), "days": days, "from": first.isoformat(), "to": today.isoformat(),
                     "devices_used": [{"device_type": k[0], "os": k[1], "browser": k[2], "logins": n} for k, n in used.most_common()]})


def _top(counter, total, limit=8):
    out = [{"label": k, "count": v, "share": round(100 * v / total) if total else 0} for k, v in counter.most_common(limit)]
    rest = sum(v for k, v in counter.most_common()[limit:])
    if rest:
        out.append({"label": "Other", "count": rest, "share": round(100 * rest / total) if total else 0})
    return out


@api_view(["GET"])
@permission_classes([IsAdminRole])
def devices(request):
    """Which devices, systems and browsers students use. Two views of it: the last device each student opened the app on (everyone who opened it
    recently), and the history of her logins (kept from the moment this update is installed)."""
    days, first, today, start = L._window(request)
    students = list(L._students(request))
    ids = [s.pk for s in students]
    pres = list(Presence.objects.filter(user_id__in=ids, last_seen__gte=start))
    n = len(pres)
    kinds = Counter((p.device_type or "unknown").capitalize() for p in pres)
    oses = Counter(f"{p.os or 'Unknown'}" for p in pres)
    brows = Counter(f"{p.browser or 'Unknown'}" for p in pres)
    models_ = Counter(p.device for p in pres if p.device)
    conn = Counter((p.connection or "unknown").upper() if p.connection else "Unknown" for p in pres)
    logins = [d or {} for d in AuditLog.objects.filter(action="login", actor_id__in=ids, created_at__gte=start).order_by().values_list("detail", flat=True)]
    rec = [d for d in logins if d.get("device_type")]
    return Response({
        "days": days, "students": len(students), "seen": n, "not_seen": len(students) - n, "installed": sum(1 for p in pres if p.standalone),
        "type": _top(kinds, n), "os": _top(oses, n), "browser": _top(brows, n), "model": _top(models_, n, 10), "connection": _top(conn, n),
        "logins": {"total": len(logins), "recorded": len(rec),
                   "type": _top(Counter(d["device_type"].capitalize() for d in rec), len(rec)), "os": _top(Counter(d.get("os") or "Unknown" for d in rec), len(rec)),
                   "browser": _top(Counter(d.get("browser") or "Unknown" for d in rec), len(rec))},
    })
