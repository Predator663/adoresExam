"""Administrator view of tournaments: who played whom, who won, who lost, the XP paid and taken. Real names (administrators already see them
elsewhere). Nothing here changes anything; it only reads."""
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from . import tournaments as T
from .adminstats import full_name
from .models import Tournament

PAGE = 25
STATUSES = ("open", "finished", "expired", "declined", "cancelled")


def _filtered(params):
    qs = Tournament.objects.select_related("challenger", "opponent", "subject", "challenger__school_class", "opponent__school_class")
    st = params.get("status")
    if st in STATUSES:
        qs = qs.filter(status=st)
    if params.get("subject"):
        qs = qs.filter(subject_id=params["subject"]) if str(params["subject"]).isdigit() else qs
    if str(params.get("form") or "").isdigit():
        f = int(params["form"])
        qs = qs.filter(Q(challenger__school_class__form_level=f) | Q(opponent__school_class__form_level=f))
    days = params.get("days")
    if str(days or "").isdigit() and int(days) > 0:
        qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=int(days)))
    q = " ".join(str(params.get("q") or "").split())
    if len(q) >= 2:
        names = Q()
        for fld in ("first_name", "last_name", "username"):
            names |= Q(**{f"challenger__{fld}__icontains": q}) | Q(**{f"opponent__{fld}__icontains": q})
        qs = qs.filter(names)
    return qs


def _player(tour, user, plays, role):
    res = tour.result or {}
    row = (res.get("players") or {}).get(str(user.pk)) or {}
    p = plays.get(user.pk)
    st = (tour.stakes or {}).get(str(user.pk)) or {}
    outcome = ""
    if tour.status == Tournament.FINISHED:
        outcome = "draw" if res.get("outcome") == "draw" else ("won" if res.get("winner_id") == user.pk else "lost") if res.get("outcome") == "win" else ""
    return {"id": user.pk, "name": full_name(user), "class": user.school_class.name if user.school_class_id else "", "form": user.school_class.form_level if user.school_class_id else None,
            "role": role, "state": "finished" if p and p.status == "finished" else "playing" if p else "not_started",
            "correct": row.get("correct"), "total": row.get("total"), "time_ms": row.get("time_ms", p.time_ms if p and p.status == "finished" else None),
            "xp": row.get("xp"), "penalty": row.get("penalty", 0), "win_pct": st.get("win_pct", 100), "outcome": outcome}


def _row(tour, now):
    plays = {p.user_id: p for p in tour.plays.all()}
    a, b = _player(tour, tour.challenger, plays, "challenger"), _player(tour, tour.opponent, plays, "opponent")
    res = tour.result or {}
    winner = next((x for x in (a, b) if x["outcome"] == "won"), None)
    loser = next((x for x in (a, b) if x["outcome"] == "lost"), None)
    upset = bool(winner and loser and winner["form"] is not None and loser["form"] is not None and winner["form"] < loser["form"])
    status = tour.status
    if status == Tournament.OPEN and tour.expires_at <= now:
        status = "expired"
    return {"id": tour.pk, "subject": tour.subject.name, "status": status, "outcome": res.get("outcome", ""), "how": res.get("how", ""),
            "questions": tour.question_count, "seconds": tour.seconds_per_question, "created_at": tour.created_at, "expires_at": tour.expires_at,
            "finished_at": tour.finished_at, "players": [a, b], "winner": winner["name"] if winner else "", "upset": upset,
            "gap": abs((a["form"] or 0) - (b["form"] or 0)) if a["form"] is not None and b["form"] is not None else 0}


def overview(params, now=None):
    now = now or timezone.now()
    T.settle_due(now)
    qs = _filtered(params)
    counts = {s: 0 for s in STATUSES}
    for s in qs.order_by().values_list("status", flat=True):
        counts[s] = counts.get(s, 0) + 1
    total = sum(counts.values())

    # everything in the filter that finished, for the totals and the table of players
    done = list(qs.filter(status=Tournament.FINISHED).prefetch_related("plays")[:5000])
    board, xp_paid, xp_taken, upsets, cross, draws = {}, 0, 0, 0, 0, 0
    for t_ in done:
        r = _row(t_, now)
        draws += 1 if r["outcome"] == "draw" else 0
        upsets += 1 if r["upset"] else 0
        cross += 1 if r["gap"] else 0
        for p in r["players"]:
            e = board.setdefault(p["id"], {"id": p["id"], "name": p["name"], "class": p["class"], "played": 0, "won": 0, "drawn": 0, "lost": 0, "xp": 0})
            e["played"] += 1
            e["won"] += p["outcome"] == "won"
            e["drawn"] += p["outcome"] == "draw"
            e["lost"] += p["outcome"] == "lost"
            e["xp"] += p["xp"] or 0
            xp_paid += (p["xp"] or 0) + (p["penalty"] or 0)   # "xp" is net of the penalty: add it back to show what was paid before the penalty
            xp_taken += p["penalty"] or 0
    top = sorted(board.values(), key=lambda e: (-e["won"], e["lost"], -e["played"], e["name"]))[:10]

    try:
        page = max(1, int(params.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    start = (page - 1) * PAGE
    rows = [_row(t_, now) for t_ in qs.prefetch_related("plays")[start:start + PAGE]]
    return {"summary": {"total": total, **counts, "draws": draws, "upsets": upsets, "cross_class": cross, "xp_paid": xp_paid, "xp_taken": xp_taken,
                        "players": len(board)},
            "top": top, "results": rows, "page": page, "pages": max(1, -(-total // PAGE)), "count": total}
