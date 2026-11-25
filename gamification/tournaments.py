"""1v1 tournaments between students of ANY class, played at different times.

How it works (the rules that keep it fair):
- A student finds an opponent by SEARCH (never a full list) and declares a tournament: subject, number of questions, seconds per question, and how long the classmate has
  (`hours`) before it times out. The questions are chosen once and frozen, so BOTH play the same ones.
- Each player gets her own question order and her own option order (so one cannot just say "the answer to number 3 is B").
- The timer belongs to the SERVER. A question's clock starts when it is first shown to her; an answer that arrives later than the
  time limit (plus a small allowance for a slow network) counts as timed out and scores 0. Closing the app does not stop the clock.
- Answers are never sent to the phone while playing, and nothing about the other player's score is shown until it is settled.
- It is settled once: when both have finished, or when the deadline passes. Higher score wins; if equal, the faster total time wins
  (a difference under 1 second is a draw). If only one player finished before the deadline it is "no contest": nobody wins, and the
  one who played still gets the small play XP. Declined and cancelled tournaments give no XP.
- XP: play XP for finishing, plus a bonus for winning or drawing; at most DAILY_XP_CAP tournaments per day pay XP (so it cannot be farmed).
  Badges come from the same badge engine as everything else. No exam mark is ever touched.
- CLASS STAKES (frozen when declared): each form apart counts as one step, up to 3. Beating a HIGHER form pays +50% win XP per step;
  beating a LOWER form pays less (-25% per step, never below 30%); LOSING to a lower form costs 10 XP per step (never below zero total XP).
  Losing to a higher form costs nothing. Questions come from the LOWER of the two forms so both have met the material.
"""
import random
from datetime import timedelta
from types import SimpleNamespace

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from academics.models import SchoolClass, Subject
from core.i18n import lang_of, t
from exams import marking
from exams.presenters import public_question
from notifications.services import notify
from . import services as S
from .models import Profile, Tournament, TournamentPlay, XPEvent

COUNTS, SECONDS, HOURS = (5, 10, 15), (15, 20, 30, 45, 60, 90), (6, 24, 48, 72)
DEFAULT_COUNT, DEFAULT_SECONDS, DEFAULT_HOURS = 10, 30, 48
GRACE_MS = 2500          # allowance for a slow network on top of the time limit
TIE_MS = 1000            # total times closer than this are a draw
MAX_OPEN_MADE = 3        # tournaments she may have waiting for classmates at once
DAILY_XP_CAP = 5         # tournaments per day that pay XP


def _err(key, status=400, code="error", lang="en", **kw):
    return S.GamificationError(t(key, lang, **kw), status, code)


def _form(user):
    return user.school_class.form_level if user.school_class_id else None


def _person(user, profile=None):
    profile = profile or S.get_profile(user)
    return {"id": user.pk, "name": S.display_name(user, profile), "avatar": profile.avatar,
            "form": _form(user), "class_name": user.school_class.name if user.school_class_id else ""}


MAX_STEP, WIN_UP, WIN_DOWN, WIN_FLOOR, LOSE_COST = 3, 50, 25, 30, 10


def stakes_for(my_form, their_form):
    """What the class gap does to ME. gap = their form minus my form (clamped to +-MAX_STEP).
    win_pct: share of the normal win XP I get if I win. penalty: XP I lose if I lose (only to a LOWER form)."""
    if my_form is None or their_form is None:
        return {"gap": 0, "win_pct": 100, "penalty": 0}
    gap = max(-MAX_STEP, min(MAX_STEP, their_form - my_form))
    if gap > 0:
        return {"gap": gap, "win_pct": 100 + WIN_UP * gap, "penalty": 0}
    if gap < 0:
        return {"gap": gap, "win_pct": max(WIN_FLOOR, 100 + WIN_DOWN * gap), "penalty": LOSE_COST * -gap}
    return {"gap": 0, "win_pct": 100, "penalty": 0}


# ---------------------------------------------------------------- who can be challenged, and the choices

def _findable(student, user_id):
    """Any active student of the school except herself, unless that student hid herself from classmates."""
    u = User.objects.filter(pk=user_id, role="student", is_active=True).select_related("school_class").exclude(pk=student.pk).first()
    if not u:
        return None
    p = Profile.objects.filter(user=u).first()
    return None if p and p.hide_from_leaderboard else u


SEARCH_MIN, SEARCH_MAX = 2, 8


def search(student, q, form=None):
    """Find an opponent by typing part of her name. Never returns everybody: needs SEARCH_MIN letters, returns at most SEARCH_MAX.
    Matches only what the leaderboard shows (the name she chose, else first name + last initial), so real surnames are not exposed."""
    q = " ".join(str(q or "").split()).lower()
    if len(q) < SEARCH_MIN:
        return []
    cand = (User.objects.filter(role="student", is_active=True).exclude(pk=student.pk).select_related("school_class")
            .filter(Q(first_name__icontains=q) | Q(gamification__display_name__icontains=q) | Q(username__icontains=q)))
    try:
        if form not in (None, ""):
            cand = cand.filter(school_class__form_level=int(form))
    except (TypeError, ValueError):
        pass
    cand = list(cand[:80])
    profiles = {p.user_id: p for p in Profile.objects.filter(user__in=cand)}
    me = _form(student)
    out = []
    for u in cand:
        p = profiles.get(u.pk)
        if p and p.hide_from_leaderboard:
            continue
        name = S.display_name(u, p)
        low = name.lower()
        if q not in low:
            continue
        rank = 0 if low.startswith(q) else 1 if any(w.startswith(q) for w in low.split()) else 2
        out.append((rank, low, _person(u, p or Profile(user=u)) | {"stakes": stakes_for(me, _form(u))}))
    out.sort(key=lambda x: (x[0], x[1]))
    return [x[2] for x in out[:SEARCH_MAX]]


def recent_opponents(student, limit=6):
    """People she played or challenged lately, newest first, so a rematch is one tap."""
    seen, out, me = set(), [], _form(student)
    rows = (Tournament.objects.filter(Q(challenger=student) | Q(opponent=student)).select_related("challenger", "opponent", "challenger__school_class", "opponent__school_class")
            .order_by("-created_at")[:40])
    for t_ in rows:
        o = t_.opponent if t_.challenger_id == student.pk else t_.challenger
        if o.pk in seen or not o.is_active:
            continue
        p = Profile.objects.filter(user=o).first()
        if p and p.hide_from_leaderboard:
            continue
        seen.add(o.pk)
        out.append(_person(o, p or Profile(user=o)) | {"stakes": stakes_for(me, _form(o))})
        if len(out) >= limit:
            break
    return out


def options(student):
    subjects = []
    for s in Subject.objects.filter(practice_enabled=True).order_by("name"):
        n = S.practice_pool(student, s).count()
        if n >= S.PRACTICE_MIN:
            subjects.append({"id": s.pk, "name": s.name, "questions": n})
    forms = sorted(set(SchoolClass.objects.values_list("form_level", flat=True)))
    return {"subjects": subjects, "recent": recent_opponents(student), "forms": forms, "my_form": _form(student),
            "counts": list(COUNTS), "seconds": list(SECONDS), "hours": list(HOURS),
            "defaults": {"count": DEFAULT_COUNT, "seconds": DEFAULT_SECONDS, "hours": DEFAULT_HOURS},
            "rules": {"win_up": WIN_UP, "win_down": WIN_DOWN, "win_floor": WIN_FLOOR, "lose_cost": LOSE_COST, "max_step": MAX_STEP}}


# ---------------------------------------------------------------- declaring

def create(student, subject_id, opponent_id, count=DEFAULT_COUNT, seconds=DEFAULT_SECONDS, hours=DEFAULT_HOURS, now=None):
    now = now or timezone.now()
    lang = lang_of(student)
    try:
        count, seconds, hours, opponent_id = int(count), int(seconds), int(hours), int(opponent_id)
    except (TypeError, ValueError):
        raise _err("tour.err.bad_option", lang=lang)
    if count not in COUNTS or seconds not in SECONDS or hours not in HOURS:
        raise _err("tour.err.bad_option", lang=lang)
    opponent_user = _findable(student, opponent_id)
    if not opponent_user:
        raise _err("tour.err.not_classmate", 400, "not_classmate", lang)
    subject = Subject.objects.filter(pk=subject_id, practice_enabled=True).first()
    if not subject:
        raise _err("tour.err.bad_option", lang=lang)
    # questions both have met: those of the LOWER form (whoever of the two is lower builds the pool)
    fa, fb = _form(student), _form(opponent_user)
    owner = opponent_user if (fa is not None and fb is not None and fb < fa) else student
    pool = list(S.practice_pool(owner, subject))
    if len(pool) < count:
        raise _err("tour.err.few_questions", 400, "few_questions", lang)
    with transaction.atomic():
        pair = Q(challenger=student, opponent_id=opponent_id) | Q(challenger_id=opponent_id, opponent=student)
        if Tournament.objects.filter(status=Tournament.OPEN, expires_at__gt=now).filter(pair).exists():
            raise _err("tour.err.already_open", 409, "already_open", lang)
        if Tournament.objects.filter(status=Tournament.OPEN, expires_at__gt=now, challenger=student).count() >= MAX_OPEN_MADE:
            raise _err("tour.err.too_many", 409, "too_many", lang)
        picks = random.SystemRandom().sample(pool, count)
        tour = Tournament.objects.create(
            challenger=student, opponent_id=opponent_id, subject=subject, question_count=count, seconds_per_question=seconds,
            expires_at=now + timedelta(hours=hours), stakes={str(student.pk): stakes_for(fa, fb), str(opponent_id): stakes_for(fb, fa)}, items=[{"qid": q.pk, "payload": S._practice_payload(q)} for q in picks])
    other = opponent_user
    ol = lang_of(other)
    until = timezone.localtime(tour.expires_at).strftime("%d %b %H:%M")
    notify([other], "tournament_invite", t("tour.invite.title", ol, name=S.display_name(student, S.get_profile(student)), subject=subject.name),
           t("tour.invite.body", ol, n=count, sec=seconds, until=until), key=f"tournament:{tour.pk}:invite", data={"tournament_id": tour.pk})
    return tour


# ---------------------------------------------------------------- playing

def _limit_ms(tour):
    return tour.seconds_per_question * 1000


def _elapsed_ms(play, now):
    return int((now - play.question_started_at).total_seconds() * 1000) if play.question_started_at else 0


def _lock(tid, user, now, lang):
    """The tournament, locked, only for one of its two players, and only while it is still open. (Callers run
    settle_due() BEFORE opening their transaction, so a settlement is never rolled back by the 'closed' error.)"""
    tour = Tournament.objects.select_for_update().filter(pk=tid).first()
    if not tour or user.pk not in (tour.challenger_id, tour.opponent_id):
        raise S.GamificationError("Tournament not found.", 404, "not_found")
    if tour.status != Tournament.OPEN or now >= tour.expires_at:
        raise _err("tour.err.closed", 409, "closed", lang)
    return tour


def _finish_play(play, now):
    play.status, play.finished_at, play.question_started_at = TournamentPlay.FINISHED, now, None
    play.score = round(sum(a["fraction"] for a in play.answers), 4)
    play.time_ms = sum(a["ms"] for a in play.answers)


def _record(play, item_index, response, fraction, ms, timed_out):
    play.answers = play.answers + [{"i": item_index, "response": response, "fraction": round(fraction, 4), "ms": int(ms), "timed_out": timed_out}]
    play.question_started_at = None


def _drop_overdue(tour, play, now):
    """She left the app on a question and came back after its time ran out: that question scores 0 and she moves on."""
    if play.status == TournamentPlay.IN_PROGRESS and play.question_started_at and _elapsed_ms(play, now) > _limit_ms(tour) + GRACE_MS:
        _record(play, play.order[len(play.answers)], None, 0.0, _limit_ms(tour), True)
        if len(play.answers) >= len(play.order):
            _finish_play(play, now)


def _serve(tour, play, now):
    if play.question_started_at is None:
        play.question_started_at = now
    n = len(play.answers)
    item = tour.items[play.order[n]]
    left = max(0, _limit_ms(tour) - _elapsed_ms(play, now))
    return {"index": n + 1, "total": len(play.order), "seconds_total": tour.seconds_per_question, "seconds_left": round(left / 1000, 1),
            "question": public_question(SimpleNamespace(pk=item["qid"], payload=item["payload"]), play.seed, True)}


def play(tid, user, now=None):
    """Start (or resume) her run. Safe to call again: the clock of the current question never restarts.
    Returns the current question {"index", "total", "seconds_total", "seconds_left", "question"} or None when she has finished."""
    now = now or timezone.now()
    lang = lang_of(user)
    settle_due(now, user)
    with transaction.atomic():
        tour = _lock(tid, user, now, lang)
        p = TournamentPlay.objects.select_for_update().filter(tournament=tour, user=user).first()
        if p is None:
            seed = random.SystemRandom().randrange(1, 2**31)
            order = list(range(len(tour.items)))
            random.Random(seed).shuffle(order)
            p = TournamentPlay.objects.create(tournament=tour, user=user, seed=seed, order=order)
        _drop_overdue(tour, p, now)
        qs = _serve(tour, p, now) if p.status == TournamentPlay.IN_PROGRESS else None
        p.save()
        if p.status == TournamentPlay.FINISHED:
            _settle_if_both(tour, now)
    return qs


def answer(tid, user, question_id, response, now=None):
    """Record her answer to the current question (the server decides if it was in time) and return the next one, or None at the end."""
    now = now or timezone.now()
    lang = lang_of(user)
    if response is not None and len(str(response)) > 5000:
        raise S.GamificationError("That answer is too long.", 400, "too_long")
    settle_due(now, user)
    with transaction.atomic():
        tour = _lock(tid, user, now, lang)
        p = TournamentPlay.objects.select_for_update().filter(tournament=tour, user=user).first()
        if p is None:
            raise S.GamificationError("Press play first.", 409, "not_started")
        if p.status == TournamentPlay.IN_PROGRESS:
            idx = len(p.answers)
            item_index = p.order[idx]
            if question_id != tour.items[item_index]["qid"]:
                if not any(tour.items[a["i"]]["qid"] == question_id for a in p.answers):
                    raise S.GamificationError("That is not the current question.", 409, "out_of_order")
                # a repeated send of an answer already recorded: change nothing, show where she is
            else:
                if p.question_started_at is None:
                    p.question_started_at = now
                elapsed = _elapsed_ms(p, now)
                if elapsed > _limit_ms(tour) + GRACE_MS:   # too late: the server decides, not the phone
                    _record(p, item_index, None, 0.0, _limit_ms(tour), True)
                else:
                    empty = response in (None, "", [], {})
                    fraction = 0.0 if empty else marking.fraction_correct(tour.items[item_index]["payload"], response, partial=True)
                    _record(p, item_index, None if empty else response, fraction, min(elapsed, _limit_ms(tour)), False)
                if len(p.answers) >= len(p.order):
                    _finish_play(p, now)
        qs = _serve(tour, p, now) if p.status == TournamentPlay.IN_PROGRESS else None
        p.save()
        if p.status == TournamentPlay.FINISHED:
            _settle_if_both(tour, now)
    return qs


# ---------------------------------------------------------------- declining, cancelling

def _no_play_by(tour, user):
    return not tour.plays.filter(user=user).exists()


def decline(tid, user, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        tour = Tournament.objects.select_for_update().filter(pk=tid, opponent=user).first()
        if not tour or tour.status != Tournament.OPEN or not _no_play_by(tour, user):
            raise _err("tour.err.closed", 409, "closed", lang_of(user))
        tour.status, tour.finished_at = Tournament.DECLINED, now
        tour.save(update_fields=["status", "finished_at"])
    cl = lang_of(tour.challenger)
    notify([tour.challenger], "tournament_result", t("tour.declined.title", cl, name=S.display_name(user, S.get_profile(user))), "",
           key=f"tournament:{tour.pk}:declined", data={"tournament_id": tour.pk}, push=False)
    return tour


def cancel(tid, user, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        tour = Tournament.objects.select_for_update().filter(pk=tid, challenger=user).first()
        if not tour or tour.status != Tournament.OPEN or not _no_play_by(tour, tour.opponent):
            raise _err("tour.err.closed", 409, "closed", lang_of(user))
        tour.status, tour.finished_at = Tournament.CANCELLED, now
        tour.save(update_fields=["status", "finished_at"])
    return tour


# ---------------------------------------------------------------- settling

def _decide(a, b):
    if abs(a.score - b.score) > 1e-6:
        return (a if a.score > b.score else b), "score"
    if abs(a.time_ms - b.time_ms) >= TIE_MS:
        return (a if a.time_ms < b.time_ms else b), "time"
    return None, "draw"


def _settle_if_both(tour, now):
    if tour.status == Tournament.OPEN and tour.plays.filter(status=TournamentPlay.FINISHED).count() == 2:
        _settle(tour, now)


def _player_row(p, total):
    return {"score": round(p.score, 2), "total": total, "correct": sum(1 for a in p.answers if a["fraction"] >= 0.9999),
            "time_ms": p.time_ms, "xp": 0}


def _settle(tour, now):
    """Decide the tournament ONCE (the caller holds the row lock) and pay the rewards."""
    if tour.status != Tournament.OPEN:
        return False
    plays = list(tour.plays.select_for_update())
    done = [p for p in plays if p.status == TournamentPlay.FINISHED]
    if len(done) == 2:
        winner, how = _decide(*done)
        outcome = "draw" if winner is None else "win"
        tour.status = Tournament.FINISHED
    elif now >= tour.expires_at:
        winner, how, outcome = None, "", ("no_contest" if done else "none")
        tour.status = Tournament.EXPIRED
    else:
        return False
    tour.finished_at = now
    total = len(tour.items)
    tour.result = {"outcome": outcome, "winner_id": winner.user_id if winner else None, "how": how,
                   "players": {str(p.user_id): _player_row(p, total) for p in done}, "badges": {}}
    tour.save(update_fields=["status", "finished_at", "result"])  # saved BEFORE the badge check: it counts this tournament
    cfg, today = S.config(), timezone.localdate(now)
    for p in done:
        _reward(tour, p, winner, outcome, cfg, today, now)
    tour.save(update_fields=["result"])
    _notify_result(tour, outcome, winner)
    return True


def _reward(tour, p, winner, outcome, cfg, today, now):
    user, row = p.user, tour.result["players"][str(p.user_id)]
    xp = 0
    capped = XPEvent.objects.filter(user=user, kind="tournament", created_at__date=today).count() >= DAILY_XP_CAP
    if not capped:
        base = f"tournament:{tour.pk}"
        ev = S.award_xp(user, "tournament", cfg["xp"]["tournament_play"], f"{base}:play", subject=tour.subject.name)
        xp += ev.points if ev else 0
        if outcome == "win" and winner.user_id == user.pk:
            pct = (tour.stakes or {}).get(str(user.pk), {}).get("win_pct", 100)
            ev = S.award_xp(user, "tournament_win", round(cfg["xp"]["tournament_win"] * pct / 100), f"{base}:win", subject=tour.subject.name, pct=pct)
            xp += ev.points if ev else 0
        elif outcome == "draw":
            ev = S.award_xp(user, "tournament_draw", cfg["xp"]["tournament_draw"], f"{base}:draw", subject=tour.subject.name)
            xp += ev.points if ev else 0
    penalty = (tour.stakes or {}).get(str(user.pk), {}).get("penalty", 0)
    if outcome == "win" and winner.user_id != user.pk and penalty > 0:  # lost to a LOWER form: costs XP, but never below zero
        cost = min(penalty, max(0, S.total_xp(user)))
        if cost > 0:
            XPEvent.objects.get_or_create(user=user, key=f"tournament:{tour.pk}:penalty",
                                          defaults={"kind": "tournament_penalty", "points": -cost, "detail": {"subject": tour.subject.name}})
            xp -= cost
            row["penalty"] = cost
    row["xp"] = xp
    row["win_pct"] = (tour.stakes or {}).get(str(user.pk), {}).get("win_pct", 100)
    S.record_activity(user, today, "practice", cfg)  # a finished tournament is a learning day
    lang = lang_of(user)
    new = S.evaluate_badges(user, cfg)
    tour.result["badges"][str(user.pk)] = [S.badge_brief(n["code"], n["scope"], n["tier"], lang) for n in new]
    S.check_level(user, cfg)


def _notify_result(tour, outcome, winner):
    for me, other in ((tour.challenger, tour.opponent), (tour.opponent, tour.challenger)):
        lang = lang_of(me)
        name = S.display_name(other, S.get_profile(other))
        mine, theirs = tour.result["players"].get(str(me.pk)), tour.result["players"].get(str(other.pk))
        if outcome in ("no_contest", "none"):
            title, body = t("tour.nocontest.title", lang, name=name), t("tour.nocontest.body", lang)
        else:
            key = "tour.draw.title" if outcome == "draw" else ("tour.win.title" if winner.user_id == me.pk else "tour.lose.title")
            title = t(key, lang, name=name)
            body = t("tour.result.body", lang, mine=f"{mine['correct']}/{mine['total']}", theirs=f"{theirs['correct']}/{theirs['total']}",
                     name=name, xp=mine["xp"])
        notify([me], "tournament_result", title, body, key=f"tournament:{tour.pk}:result", data={"tournament_id": tour.pk})


def settle_due(now=None, user=None):
    """Settle every tournament whose deadline has passed. Called by the scheduler and whenever a student opens her list."""
    now = now or timezone.now()
    qs = Tournament.objects.filter(status=Tournament.OPEN, expires_at__lte=now)
    if user is not None:
        qs = qs.filter(Q(challenger=user) | Q(opponent=user))
    n = 0
    for tid in list(qs.values_list("pk", flat=True)):
        with transaction.atomic():
            tour = Tournament.objects.select_for_update().get(pk=tid)
            n += 1 if _settle(tour, now) else 0
    return n


# ---------------------------------------------------------------- what the screens show

def _side(tour, user, plays, profiles):
    p = plays.get(user.pk)
    status = "finished" if p and p.status == TournamentPlay.FINISHED else "playing" if p else "not_started"
    return _person(user, profiles.get(user.pk)) | {"status": status}


def view(tour, viewer, now=None, plays=None):
    """One tournament as the viewer may see it. The other player's score appears only once it is settled."""
    now = now or timezone.now()
    plays = plays if plays is not None else {p.user_id: p for p in tour.plays.all()}
    other = tour.opponent if viewer.pk == tour.challenger_id else tour.challenger
    profiles = {p.user_id: p for p in Profile.objects.filter(user__in=[viewer, other])}
    mine = plays.get(viewer.pk)
    me, them = _side(tour, viewer, plays, profiles), _side(tour, other, plays, profiles)
    open_ = tour.status == Tournament.OPEN and now < tour.expires_at
    out = {"id": tour.pk, "subject": tour.subject.name, "status": tour.status, "question_count": tour.question_count,
           "seconds_per_question": tour.seconds_per_question, "created_at": tour.created_at, "expires_at": tour.expires_at,
           "role": "challenger" if viewer.pk == tour.challenger_id else "opponent", "me": me, "opponent": them,
           "can_play": open_ and me["status"] != "finished",
           "can_decline": open_ and viewer.pk == tour.opponent_id and not mine,
           "can_cancel": open_ and viewer.pk == tour.challenger_id and them["status"] == "not_started",
           "stakes": (tour.stakes or {}).get(str(viewer.pk)) or stakes_for(None, None)}
    if tour.status != Tournament.OPEN:
        out["result"] = _result_for(tour, viewer, other, plays)
    return out


def _result_for(tour, viewer, other, plays):
    r = tour.result or {}
    me, op = str(viewer.pk), str(other.pk)
    outcome = r.get("outcome", "")
    if outcome == "win":
        outcome = "won" if r.get("winner_id") == viewer.pk else "lost"
    res = {"outcome": outcome, "how": r.get("how", ""), "me": (r.get("players") or {}).get(me), "opponent": (r.get("players") or {}).get(op),
           "badges": (r.get("badges") or {}).get(me, [])}
    if tour.status == Tournament.FINISHED and plays.get(viewer.pk) and plays.get(other.pk):
        mine = {a["i"]: a for a in plays[viewer.pk].answers}
        theirs = {a["i"]: a for a in plays[other.pk].answers}
        res["questions"] = [{"prompt": str(it["payload"].get("prompt", ""))[:160], "me": mine.get(i, {}).get("fraction", 0), "opponent": theirs.get(i, {}).get("fraction", 0),
                             "me_ms": mine.get(i, {}).get("ms", 0), "opponent_ms": theirs.get(i, {}).get("ms", 0)} for i, it in enumerate(tour.items)]
    return res


def detail(tid, viewer, now=None):
    now = now or timezone.now()
    settle_due(now, viewer)
    tour = Tournament.objects.select_related("challenger", "opponent", "subject").filter(pk=tid).filter(Q(challenger=viewer) | Q(opponent=viewer)).first()
    if not tour:
        raise S.GamificationError("Tournament not found.", 404, "not_found")
    return view(tour, viewer, now)


def overview(student, now=None):
    now = now or timezone.now()
    settle_due(now, student)
    rows = list(Tournament.objects.filter(Q(challenger=student) | Q(opponent=student)).select_related("challenger", "opponent", "subject")
                .prefetch_related("plays").order_by("-created_at")[:80])
    invites, active, history = [], [], []
    record = {"played": 0, "won": 0, "drawn": 0, "lost": 0}
    for tour in rows:
        v = view(tour, student, now, {p.user_id: p for p in tour.plays.all()})
        if tour.status == Tournament.OPEN:
            (invites if v["role"] == "opponent" and v["me"]["status"] == "not_started" else active).append(v)
        else:
            history.append(v)
            if tour.status == Tournament.FINISHED:
                o = v["result"]["outcome"]
                record["played"] += 1
                record["won" if o == "won" else "drawn" if o == "draw" else "lost"] += 1
    return {"invites": invites, "active": active, "history": history[:20], "record": record}


def invites(student, now=None):
    """Challenges waiting for HER: open, from a classmate, not yet started by her, not past the deadline. Cheap enough to poll
    (the pop-up at the top of every page uses it)."""
    now = now or timezone.now()
    settle_due(now, student)
    rows = (Tournament.objects.filter(opponent=student, status=Tournament.OPEN, expires_at__gt=now).exclude(plays__user=student)
            .select_related("challenger", "opponent", "subject").prefetch_related("plays").order_by("-created_at")[:10])
    return [view(t_, student, now, {p.user_id: p for p in t_.plays.all()}) for t_ in rows]
