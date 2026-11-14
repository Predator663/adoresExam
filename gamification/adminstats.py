"""What an administrator sees about gamification (ADM-08): who is on top, how levels and badges are spread across the school,
and one student's details. Numbers only: no exam marks appear here, and nothing here changes anything.

The school is a few hundred students, so each call reads their XP and badges once and works the rest out in memory."""
from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from accounts.models import User
from . import catalog, rules, services
from .models import ActivityDay, BadgeAward, Profile, XPEvent

TIERS = ("bronze", "silver", "gold")


def students():
    return User.objects.filter(role=User.Role.STUDENT, is_active=True, is_archived=False).select_related("school_class")


def full_name(u):
    return f"{u.first_name} {u.last_name}".strip() or u.username


def _photos(ids):
    return {p.user_id: services.photo_url(p) for p in Profile.objects.filter(user_id__in=ids).exclude(photo="")}


def _xp_by_user(ids):
    return dict(XPEvent.objects.filter(user_id__in=ids).order_by().values_list("user_id").annotate(s=Sum("points")))


def _badge_counts(ids):
    """{user_id: [bronze, silver, gold]} and {badge code: [bronze, silver, gold]}."""
    per_user, per_code = defaultdict(lambda: [0, 0, 0]), defaultdict(lambda: [0, 0, 0])
    for uid, code, tier in BadgeAward.objects.filter(user_id__in=ids).values_list("user_id", "code", "tier"):
        if 1 <= tier <= 3:
            per_user[uid][tier - 1] += 1
            per_code[code][tier - 1] += 1
    return per_user, per_code


def _card(u, xp, cfg, badges, photo=""):
    lvl = services.level_payload(xp, cfg, "en")
    return {"id": u.pk, "name": full_name(u), "username": u.username, "index": u.index_number,
            "class": str(u.school_class) if u.school_class_id else "", "xp": xp, "level": lvl["level"], "level_name": lvl["name"],
            "badges": sum(badges), "gold": badges[2], "photo": photo}


def overview(now=None):
    now = now or timezone.now()
    today, cfg = timezone.localdate(now), services.config()
    people = list(students())
    ids = [u.pk for u in people]
    xp = _xp_by_user(ids)
    per_user, per_code = _badge_counts(ids)

    # levels: how many students are at each one
    table = services.level_table(cfg)
    at = Counter(rules.level_for(xp.get(uid, 0), cfg["levels"])["level"] for uid in ids)
    levels = [{"level": lv["level"], "name": lv["name"], "from_xp": lv["xp"], "count": at.get(lv["level"], 0)} for lv in table]

    # top three by XP (ties: more badges first, then name)
    ranked = sorted((u for u in people if xp.get(u.pk, 0) > 0), key=lambda u: (-xp[u.pk], -sum(per_user[u.pk]), full_name(u).lower()))[:3]
    eng = services.engagement_for([u.pk for u in ranked]) if ranked else {}
    photos = _photos([u.pk for u in ranked])
    top = []
    for i, u in enumerate(ranked, start=1):
        top.append({**_card(u, xp[u.pk], cfg, per_user[u.pk], photos.get(u.pk, "")), "rank": i,
                    "streak": eng.get(u.pk, {}).get("current_streak", 0), "best_streak": eng.get(u.pk, {}).get("best_streak", 0)})

    # badges: how many of each, by tier
    badge_rows = [{"code": b["code"], "name": catalog.badge_name(b["code"], "en"), "bronze": per_code[b["code"]][0],
                   "silver": per_code[b["code"]][1], "gold": per_code[b["code"]][2], "total": sum(per_code[b["code"]])}
                  for b in catalog.BADGES]
    tier_totals = [sum(per_code[b["code"]][i] for b in catalog.BADGES) for i in range(3)]

    # XP given per day, last 14 days (East Africa days), zeros included so the line has no gaps
    since = today - timedelta(days=13)
    by_day = {d: s for d, s in XPEvent.objects.filter(user_id__in=ids, created_at__date__gte=since).order_by()
              .annotate(d=TruncDate("created_at")).values_list("d").annotate(s=Sum("points"))}
    daily = [{"day": (since + timedelta(days=i)).isoformat(), "xp": int(by_day.get(since + timedelta(days=i), 0) or 0)} for i in range(14)]
    active7 = ActivityDay.objects.filter(user_id__in=ids, day__gte=today - timedelta(days=6)).values("user_id").distinct().count()

    n = len(people)
    holders = sum(1 for uid in ids if sum(per_user[uid]))
    return {
        "students": n, "total_xp": sum(xp.get(uid, 0) for uid in ids), "average_xp": round(sum(xp.get(uid, 0) for uid in ids) / n) if n else 0,
        "total_badges": sum(tier_totals), "badge_holders": holders, "tier_totals": dict(zip(TIERS, tier_totals)),
        "active_last_7_days": active7, "top_level": max((lv["level"] for lv in table), default=1),
        "average_level": round(sum(rules.level_for(xp.get(uid, 0), cfg["levels"])["level"] for uid in ids) / n, 1) if n else 0,
        "top": top, "levels": levels, "badges": badge_rows, "daily_xp": daily,
    }


def search(q, limit=8):
    qs = students()
    for term in q.split()[:3]:
        qs = qs.filter(Q(first_name__icontains=term) | Q(last_name__icontains=term) | Q(username__icontains=term) | Q(index_number__icontains=term))
    found = list(qs.order_by("first_name", "last_name")[:limit])
    ids = [u.pk for u in found]
    cfg, xp, photos = services.config(), _xp_by_user(ids), _photos(ids)
    per_user, _ = _badge_counts(ids)
    return [_card(u, xp.get(u.pk, 0), cfg, per_user[u.pk], photos.get(u.pk, "")) for u in found]


def detail(student, now=None):
    now = now or timezone.now()
    today, cfg = timezone.localdate(now), services.config()
    xp = services.total_xp(student)
    lvl = services.level_payload(xp, cfg, "en")
    profile = services.get_profile(student)
    # rank in the school and in her class (equal XP shares a rank)
    base = students()
    everyone = _xp_by_user([u.pk for u in base])
    rank = 1 + sum(1 for v in everyone.values() if v > xp)
    mates = [u.pk for u in base if student.school_class_id and u.school_class_id == student.school_class_id]
    class_rank = 1 + sum(1 for uid in mates if everyone.get(uid, 0) > xp) if mates else None
    streak = rules.streak_status(services.activity_days(student), today, cfg["freezes"])
    exam_cur, exam_best = services.exam_streak(student)
    cabinet = services.badge_cabinet(student, cfg, "en")
    earned = sorted((c for c in cabinet if c["earned"]), key=lambda c: (-c["tier_index"], c["name"]))
    nearest = sorted((c for c in cabinet if c["next_target"]), key=lambda c: -(c["progress"] / c["next_target"]))[:3]
    kinds = XPEvent.objects.filter(user=student).order_by().values("kind").annotate(points=Sum("points"), n=Count("id")).order_by("-points")
    since = today - timedelta(days=13)
    by_day = {d: s for d, s in XPEvent.objects.filter(user=student, created_at__date__gte=since).order_by()
              .annotate(d=TruncDate("created_at")).values_list("d").annotate(s=Sum("points"))}
    recent = [{"at": e.created_at, "points": e.points, "label": services.xp_label(e, "en")} for e in XPEvent.objects.filter(user=student)[:8]]
    eng = services.engagement_for([student.pk])[student.pk]
    return {
        "id": student.pk, "name": full_name(student), "username": student.username, "index": student.index_number,
        "class": str(student.school_class) if student.school_class_id else "", "photo": services.photo_url(profile), "avatar": profile.avatar,
        "xp": xp, "level": lvl, "rank": rank, "of": len(everyone), "class_rank": class_rank, "class_size": len(mates),
        "streak": {"current": streak["current"], "best": streak["best"]}, "exam_streak": {"current": exam_cur, "best": exam_best},
        "badges_earned": [{"code": c["code"], "name": c["name"], "subject": c["subject"], "tier": c["tier"], "tier_label": c["tier_label"],
                           "earned_at": c["earned_at"]} for c in earned],
        "badge_total": len(earned), "badge_catalog_total": len(catalog.BADGES),
        "next_goals": [{"code": c["code"], "name": c["name"], "subject": c["subject"], "progress": c["progress"],
                        "target": c["next_target"], "unit": c["unit"]} for c in nearest],
        "xp_by_kind": [{"kind": k["kind"], "points": k["points"], "count": k["n"]} for k in kinds],
        "daily_xp": [{"day": (since + timedelta(days=i)).isoformat(), "xp": int(by_day.get(since + timedelta(days=i), 0) or 0)} for i in range(14)],
        "recent": recent, "active_days_last_30": eng["active_days_last_30"], "practice_sessions": eng["practice_sessions"],
        "practice_average_percent": eng["practice_average_percent"], "hidden_from_leaderboard": profile.hide_from_leaderboard,
    }
