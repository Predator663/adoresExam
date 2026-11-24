"""Gamification services: XP, levels, streaks, badges, review tracking, practice mode, leaderboard
(SRS section 5) and the engagement numbers teachers and admins see (TCH-03, ADM-08).

Rules this file never breaks:
- BR-10: rewards never change marks, are given only AFTER results are published, and never reveal
  other students' marks. Exam rewards are processed by `reward_attempt`, which refuses to run
  until the exam is Published and the student's own results are visible.
- Every award is idempotent. XP has a unique `key` per student, and each exam is processed once
  (`ExamRewardMark`), so lazy calls, cron calls and double taps can never pay twice.
- A problem here must never stop a student seeing her results: callers wrap these calls.
- Days follow East Africa Time (`timezone.localdate`).
"""
import logging
import random
from collections import Counter, defaultdict
from datetime import timedelta
from types import SimpleNamespace

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Sum
from django.utils import timezone

from academics.models import SchoolClass, Subject, Term
from accounts.models import User
from core import grading
from core.i18n import lang_of, t
from core.models import SchoolSettings
from exams import marking, services as exam_services
from exams.models import Attempt, Exam, ExamQuestion, Result
from exams.presenters import public_question
from notifications.services import notify
from questions.models import Question
from . import adaptive as adapt, catalog, rules
from .models import (AVATARS, FRAMES, ActivityDay, BadgeAward, ExamRewardMark, GamificationSettings, PracticeSession, Profile,
                     ReviewProgress, XPEvent)

log = logging.getLogger(__name__)

PRACTICE_MIN, PRACTICE_MAX, PRACTICE_DEFAULT = 5, 20, 10  # SRS 5.3: a streak needs a quiz of at least 5 questions
DAILY_BONUS_XP = 15  # once a day, for finishing the day's challenge
PRACTICE_STALE_HOURS = 12  # an unfinished quiz older than this is abandoned when a new one starts


class GamificationError(Exception):
    def __init__(self, message, status=400, code="error"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


# ---------------------------------------------------------------- configuration

def config():
    """The effective settings: SRS defaults with the admin's changes on top."""
    s = GamificationSettings.load()
    xp = dict(rules.DEFAULT_XP)
    xp.update({k: v for k, v in (s.xp_values or {}).items() if k in rules.DEFAULT_XP})
    tiers = {b["code"]: list(b["tiers"]) for b in catalog.BADGES}
    tiers.update({k: list(v) for k, v in (s.badge_tiers or {}).items() if k in tiers})
    return {"xp": xp, "levels": s.levels or rules.DEFAULT_LEVELS, "tiers": tiers,
            "freezes": s.freezes_per_month, "practice_cap": s.practice_daily_xp_quizzes}


def get_profile(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return profile


def display_name(user, profile=None):
    """What classmates see (SRS 5.6): the name she chose, else 'Amina K.' (first name and last initial)."""
    if profile is not None and profile.display_name.strip():
        return profile.display_name.strip()
    first, last = (user.first_name or "").strip(), (user.last_name or "").strip()
    if first and last:
        return f"{first} {last[0].upper()}."
    return first or user.username


# ---------------------------------------------------------------- XP and levels

def total_xp(user):
    return XPEvent.objects.filter(user=user).aggregate(s=Sum("points"))["s"] or 0


def level_table(cfg):
    """All levels, sorted, each with a Swahili name (falls back to the English one if an admin gave none)."""
    return [{"level": lv["level"], "name": lv["name"], "name_sw": lv.get("name_sw") or lv["name"], "xp": lv["xp"]}
            for lv in sorted(cfg["levels"], key=lambda lv: lv["xp"])]


def level_payload(xp, cfg, lang="en"):
    lvl = rules.level_for(xp, cfg["levels"])
    sw = lang == "sw"
    return {**lvl, "name": lvl["name_sw"] if sw else lvl["name"],
            "next_name": (lvl["next_name_sw"] if sw else lvl["next_name"])}


def award_xp(user, kind, points, key, exam_id=None, **detail):
    """Give XP once per `key`. Returns the new XPEvent, or None if it was zero or already given."""
    if points <= 0:
        return None
    ev, created = XPEvent.objects.get_or_create(
        user=user, key=key, defaults={"kind": kind, "points": points, "exam_id": exam_id, "detail": detail})
    return ev if created else None


def xp_label(event, lang="en"):
    key = {"submit": "xp.submit", "early": "xp.early", "score": "xp.score", "improve": "xp.improve",
           "perfect": "xp.perfect", "review": "xp.review", "practice": "xp.practice", "streak": "xp.streak", "daily": "xp.daily"}.get(event.kind)
    return t(key, lang, **(event.detail or {})) if key else event.kind


def check_level(user, cfg):
    """Tell the student when she reaches a new level (once per level)."""
    lvl = level_payload(total_xp(user), cfg, lang_of(user))
    if lvl["level"] > 1:
        lang = lang_of(user)
        notify([user], "level_up", t("level.up.title", lang, name=lvl["name"]),
               t("level.up.body", lang, level=lvl["level"]), key=f"level:{lvl['level']}",
               data={"level": lvl["level"]}, push=False)
    return lvl


# ---------------------------------------------------------------- streaks

def activity_days(user):
    return list(ActivityDay.objects.filter(user=user).values_list("day", flat=True))


def sync_streak(user, cfg):
    """Work the streaks out again from all learning days and pay any milestone not yet paid (3, 7, 14, 30 days)."""
    runs, _ = rules.compute_runs(activity_days(user), cfg["freezes"])
    for run in runs:
        for n in rules.STREAK_MILESTONES:
            if run["length"] >= n:
                award_xp(user, "streak", cfg["xp"][f"streak_{n}"], f"streak:{n}:{run['start'].isoformat()}", n=n)
    return runs


def record_activity(user, day, source, cfg):
    """Count `day` as a learning day (a practice quiz of 5+ questions, an exam, or a review of results)."""
    ActivityDay.objects.get_or_create(user=user, day=day, defaults={"source": source})
    return sync_streak(user, cfg)


def exam_streak(student):
    """Exam participation streak: consecutive scheduled exams (with published results) she sat."""
    exam_ids = list(Exam.objects.filter(pk__in=exam_services.exams_for_student(student).values("pk"), status=Exam.PUBLISHED)
                    .order_by("start_at").values_list("pk", flat=True))
    took = set(Attempt.objects.filter(student=student, exam_id__in=exam_ids).values_list("exam_id", flat=True))
    return rules.exam_streak([pk in took for pk in exam_ids])


# ---------------------------------------------------------------- badges

def compute_metrics(student, cfg, today=None):
    """Every number the badges are earned from, worked out from her processed results and activity.
    Only exams whose rewards were processed (hence published and visible to her) are counted."""
    today = today or timezone.localdate()
    marked = list(ExamRewardMark.objects.filter(user=student).values_list("exam_id", flat=True))
    rows = list(Result.objects.filter(student=student, exam_id__in=marked, attempt__attempt_no=1)
                .select_related("exam", "attempt"))
    m = {"exams_completed": 0, "perfect_scores": 0, "steady_exams": 0, "early_starts": 0}
    by_subject = defaultdict(list)
    top = Counter()
    by_term = defaultdict(lambda: defaultdict(list))
    for r in rows:
        e, a = r.exam, r.attempt
        m["exams_completed"] += 1
        if r.percent >= 100 - 1e-9:
            m["perfect_scores"] += 1
        if a.status == Attempt.SUBMITTED and not a.ended_by_id and r.percent >= rules.STEADY_PACE_PERCENT:
            m["steady_exams"] += 1
        if e.start_at and a.started_at <= e.start_at + timedelta(minutes=rules.EARLY_START_MINUTES):
            m["early_starts"] += 1
        start = e.start_at or a.started_at
        by_subject[e.subject_id].append((start, r.percent))
        if rules.is_top_grade(r.points, r.scale_snapshot):
            top[e.subject_id] += 1
        if e.term_id:
            by_term[e.term_id][e.subject_id].append((start, r.percent, r.scale_snapshot))
    m["comebacks"] = sum(rules.count_comebacks([p for _, p in sorted(items, key=lambda x: x[0])])
                         for items in by_subject.values())
    m["top_grades_by_subject"] = dict(top)

    rounder = 0  # All-Rounder: grade B or better in every subject, for a term that has ended
    ends = dict(Term.objects.filter(pk__in=list(by_term)).values_list("pk", "end_date"))
    for term_id, subjects in by_term.items():
        if len(subjects) < rules.ALL_ROUNDER_MIN_SUBJECTS or not (ends.get(term_id) and ends[term_id] < today):
            continue
        ok = True
        for items in subjects.values():
            scale = sorted(items, key=lambda x: x[0])[-1][2]
            avg = sum(p for _, p, _ in items) / len(items)
            if grading.grade_for(avg, scale)["points"] > rules.second_best_points(scale):
                ok = False
                break
        rounder += 1 if ok else 0
    m["all_rounder_terms"] = rounder

    m["best_streak"] = rules.streak_status(activity_days(student), today, cfg["freezes"])["best"]
    m["reviewed_exams"] = ReviewProgress.objects.filter(attempt__student=student, completed=True).count()
    m.update(_practice_metrics(student))
    m["total_xp"] = total_xp(student)
    return m


def _practice_metrics(student):
    """Numbers for the practice badges, from her finished quizzes (oldest first, so 'in a row' follows the order she answered)."""
    sessions = list(PracticeSession.objects.filter(user=student, status=PracticeSession.COMPLETED).order_by("started_at")
                    .only("subject_id", "answers", "question_count", "correct_score", "started_at", "completed_at"))
    m = {"practice_quizzes": len(sessions), "questions_answered": 0, "flawless_quizzes": 0, "strong_quizzes": 0, "answer_run": 0,
         "morning_quizzes": 0, "weekend_days": 0}
    run, weekend = 0, set()
    for s in sessions:
        n = s.question_count or len(s.answers)
        m["questions_answered"] += len(s.answers)
        if n and s.correct_score >= n - 1e-6:
            m["flawless_quizzes"] += 1
        if n and s.correct_score / n >= 0.8 - 1e-9:
            m["strong_quizzes"] += 1
        for a in s.answers:
            run = run + 1 if a.get("fraction", 0) >= 0.9999 else 0
            m["answer_run"] = max(m["answer_run"], run)
        done = timezone.localtime(s.completed_at or s.started_at)
        if done.hour < 8:
            m["morning_quizzes"] += 1
        if done.weekday() >= 5:
            weekend.add(done.date())
    m["weekend_days"] = len(weekend)
    m["practice_subjects"] = len({s.subject_id for s in sessions})
    return m


def _subject_name(scope):
    if not scope:
        return None
    return Subject.objects.filter(pk=int(scope)).values_list("name", flat=True).first()


def badge_brief(code, scope, tier, lang="en"):
    """A badge as the app shows it right after it is earned."""
    return {"code": code, "scope": scope, "subject": _subject_name(scope), "tier": catalog.tier_key(tier), "tier_index": tier,
            "name": catalog.badge_name(code, lang, tier), "tier_label": catalog.tier_label(tier, lang),
            "description": catalog.badge_desc(code, lang)}


def evaluate_badges(student, cfg, metrics=None):
    """Give any badge or tier the student has now earned. Returns the new ones as [{"code", "scope", "tier"}]."""
    metrics = metrics if metrics is not None else compute_metrics(student, cfg)
    existing = {(b.code, b.scope): b for b in BadgeAward.objects.filter(user=student)}
    lang = lang_of(student)
    new = []
    for b in catalog.BADGES:
        thresholds = cfg["tiers"][b["code"]]
        if b.get("per_subject"):
            values = {str(sid): n for sid, n in metrics.get(b["metric"], {}).items()}
        else:
            values = {"": metrics.get(b["metric"], 0)}
        for scope, value in values.items():
            tier = rules.tier_for(value, thresholds)
            if tier == 0:
                continue
            cur = existing.get((b["code"], scope))
            if cur is None:
                try:
                    with transaction.atomic():
                        BadgeAward.objects.create(user=student, code=b["code"], scope=scope, tier=tier)
                except IntegrityError:
                    continue  # another request just gave it
            elif tier > cur.tier:
                cur.tier, cur.seen = tier, False
                cur.save(update_fields=["tier", "seen", "updated_at"])
            else:
                continue
            new.append({"code": b["code"], "scope": scope, "tier": tier})
            brief = badge_brief(b["code"], scope, tier, lang)
            title_name = brief["name"] + (f" - {brief['subject']}" if brief["subject"] else "")
            notify([student], "badge", t("badge.title", lang, name=title_name, tier=brief["tier_label"]),
                   t("badge.body", lang, desc=brief["description"]), key=f"badge:{b['code']}:{scope}:{tier}",
                   data={"code": b["code"], "scope": scope, "tier": tier}, push=False)
    return new


def badge_cabinet(student, cfg, lang="en"):
    """The badge cabinet (SRS 5.4): every badge with her tier, progress and next target."""
    metrics = compute_metrics(student, cfg)
    awards = {(b.code, b.scope): b for b in BadgeAward.objects.filter(user=student)}
    subjects = {str(s.pk): s.name for s in Subject.objects.all()}
    out = []
    for b in catalog.BADGES:
        thresholds = cfg["tiers"][b["code"]]
        if b.get("per_subject"):
            progress = {str(sid): n for sid, n in metrics.get(b["metric"], {}).items()}
            for (code, scope) in awards:
                if code == b["code"]:
                    progress.setdefault(scope, 0)
            scopes = sorted(progress) or [""]
            values = {s: progress.get(s, 0) for s in scopes}
        else:
            values = {"": metrics.get(b["metric"], 0)}
        for scope, value in values.items():
            award = awards.get((b["code"], scope))
            tier = max(award.tier if award else 0, rules.tier_for(value, thresholds))
            out.append({
                "code": b["code"], "scope": scope, "subject": subjects.get(scope) if scope else None,
                "name": catalog.badge_name(b["code"], lang, tier or None), "description": catalog.badge_desc(b["code"], lang),
                "unit": catalog.badge_unit(b["code"], lang), "earned": tier > 0, "tier": catalog.tier_key(tier), "tier_index": tier,
                "tier_label": catalog.tier_label(tier, lang) if tier else None,
                "progress": value, "next_target": rules.next_target(value, thresholds) if tier < 3 else None,
                "tiers": [{"tier": key, "label": catalog.tier_label(i, lang), "target": th, "reached": tier >= i}
                          for i, (key, th) in enumerate(zip(rules.TIER_NAMES, thresholds), start=1)],
                "new": bool(award and not award.seen),
                "earned_at": award.updated_at if award else None,
            })
    return out


# ---------------------------------------------------------------- exam rewards (BR-10)

def previous_percent(student, exam):
    """Her percentage in the closest earlier exam of the same subject (for 'beat your previous score')."""
    return (Result.objects.filter(student=student, exam__subject_id=exam.subject_id, exam__status=Exam.PUBLISHED,
                                  exam__start_at__lt=exam.start_at, attempt__attempt_no=1)
            .order_by("-exam__start_at").values_list("percent", flat=True).first())


def reward_attempt(attempt, now=None):
    """Hand out the XP, streak credit and badges for one exam, exactly once, and only after her results
    are published and visible (BR-10). Returns True if it rewarded now, False if not due or already done.

    Only the first attempt is rewarded: a retake is a special admin arrangement (for example after a
    power cut) and must not let anyone collect the same XP twice."""
    now = now or timezone.now()
    if attempt.attempt_no != 1 or attempt.status == Attempt.IN_PROGRESS:
        return False
    exam, student = attempt.exam, attempt.student
    exam_services.sync_exam(exam, now)
    if exam.status != Exam.PUBLISHED or not exam_services.result_visible(attempt, now):
        return False
    result = Result.objects.filter(attempt=attempt).first()
    if result is None or ExamRewardMark.objects.filter(user=student, exam_id=exam.pk).exists():
        return False
    cfg = config()
    xp = cfg["xp"]
    try:
        with transaction.atomic():
            mark = ExamRewardMark.objects.create(user=student, exam_id=exam.pk)
            award_xp(student, "submit", xp["submit_exam"], f"submit:{exam.pk}", exam.pk)
            if attempt.status == Attempt.SUBMITTED and not attempt.ended_by_id:
                award_xp(student, "early", xp["finish_early"], f"early:{exam.pk}", exam.pk)
            award_xp(student, "score", rules.score_xp(result.percent, xp["score_per_percent"], xp["score_max"]),
                     f"score:{exam.pk}", exam.pk, percent=int(result.percent + 0.5))
            prev = previous_percent(student, exam)
            if prev is not None and result.percent > prev + 1e-9:
                award_xp(student, "improve", xp["improvement"], f"improve:{exam.pk}", exam.pk)
            if result.percent >= 100 - 1e-9:
                award_xp(student, "perfect", xp["perfect_score"], f"perfect:{exam.pk}", exam.pk)
            record_activity(student, timezone.localtime(attempt.started_at).date(), "exam", cfg)
            mark.badges = evaluate_badges(student, cfg)
            mark.save(update_fields=["badges"])
            check_level(student, cfg)
    except IntegrityError:
        return False  # a second request processed the same exam at the same moment
    return True


def reconcile_exam_rewards(attempt, result):
    """An administrator corrected a question and this student's result changed (exams/corrections.py): make the XP that exam earned her
    match her NEW percentage, so the ledger never keeps paying for a wrong mark. Score XP and the improvement / perfect-score bonuses are
    re-settled (raised, lowered or removed); XP for submitting and finishing early does not depend on the mark. A badge she already
    earned is never taken away; a badge the new mark now earns is given. Does nothing if her rewards for this exam were never processed
    (they will simply use the corrected result when they are). Returns True if it touched anything."""
    if attempt.attempt_no != 1:
        return False
    mark = ExamRewardMark.objects.filter(user=attempt.student, exam_id=attempt.exam_id).first()
    if mark is None:
        return False
    cfg, student, exam = config(), attempt.student, attempt.exam
    xp = cfg["xp"]

    def settle(kind, key, points, **detail):
        ev = XPEvent.objects.filter(user=student, key=key).first()
        if points > 0 and ev is None:
            XPEvent.objects.create(user=student, kind=kind, points=points, key=key, exam_id=exam.pk, detail=detail)
        elif points > 0 and (ev.points != points or ev.detail != detail):
            ev.points, ev.detail = points, detail
            ev.save(update_fields=["points", "detail"])
        elif points <= 0 and ev is not None:
            ev.delete()

    prev = previous_percent(student, exam)
    settle("score", f"score:{exam.pk}", rules.score_xp(result.percent, xp["score_per_percent"], xp["score_max"]), percent=int(result.percent + 0.5))
    settle("improve", f"improve:{exam.pk}", xp["improvement"] if prev is not None and result.percent > prev + 1e-9 else 0)
    settle("perfect", f"perfect:{exam.pk}", xp["perfect_score"] if result.percent >= 100 - 1e-9 else 0)
    new_badges = evaluate_badges(student, cfg) or []
    if new_badges:
        mark.badges = list(mark.badges or []) + list(new_badges)
        mark.save(update_fields=["badges"])
    return True


def reward_pending_for(student, now=None):
    """Process any published exam this student has not been rewarded for yet. Called when she opens her
    home page or results, so correctness never depends on the cron job."""
    now = now or timezone.now()
    done = set(ExamRewardMark.objects.filter(user=student).values_list("exam_id", flat=True))
    attempts = (Attempt.objects.filter(student=student, attempt_no=1).exclude(status=Attempt.IN_PROGRESS)
                .exclude(exam_id__in=done).select_related("exam", "student", "exam__subject"))
    return sum(1 for a in attempts if reward_attempt(a, now))


def reward_pending(now=None, limit=2000):
    """Scheduler entry point: reward every published exam attempt not yet processed. Returns how many."""
    now = now or timezone.now()
    marked = ExamRewardMark.objects.filter(user=OuterRef("student"), exam_id=OuterRef("exam_id"))
    attempts = (Attempt.objects.filter(attempt_no=1, exam__status=Exam.PUBLISHED, exam__end_at__gte=now - timedelta(days=90))
                .exclude(status=Attempt.IN_PROGRESS).annotate(done=Exists(marked)).filter(done=False)
                .select_related("exam", "student", "exam__subject").order_by("exam_id")[:limit])
    count = 0
    for a in attempts:
        try:
            count += 1 if reward_attempt(a, now) else 0
        except Exception:  # one bad row must not stop the others
            log.exception("could not reward attempt %s", a.pk)
    return count


def rewards_for_attempt(attempt, lang=None):
    """What this exam earned her (RES-03): XP lines and badges."""
    lang = lang or lang_of(attempt.student)
    events = XPEvent.objects.filter(user=attempt.student, exam_id=attempt.exam_id).order_by("id")
    items = [{"kind": e.kind, "points": e.points, "label": xp_label(e, lang)} for e in events]
    mark = ExamRewardMark.objects.filter(user=attempt.student, exam_id=attempt.exam_id).first()
    badges = [badge_brief(b["code"], b["scope"], b["tier"], lang) for b in (mark.badges if mark else [])]
    return {"xp_total": sum(i["points"] for i in items), "xp": items, "badges": badges}


# ---------------------------------------------------------------- review mode (Mistake Master)

def wrong_numbers(attempt):
    """Question numbers she did not get full marks for (unanswered counts). Voided questions are left out."""
    answers = {a.exam_question_id: a for a in attempt.answers.all()}
    out = []
    for eq in attempt.exam.questions.all():
        if eq.voided:
            continue
        a = answers.get(eq.pk)
        got = a.marks_awarded if (a is not None and a.marks_awarded is not None) else 0.0
        if got < eq.payload["marks"] - 1e-9:
            out.append(eq.position)
    return out


def review_progress(attempt, lang="en"):
    prog = ReviewProgress.objects.filter(attempt=attempt).first()
    wrong = wrong_numbers(attempt)
    return {"wrong": wrong, "seen": prog.seen if prog else [], "completed": bool(prog and prog.completed),
            "all_correct": not wrong,
            "message": t("review.nothing", lang) if not wrong else (t("review.done", lang) if prog and prog.completed else "")}


def mark_reviewed(attempt, numbers, now=None):
    """The student viewed these question numbers in review mode. When she has seen every wrong answer
    she earns the review XP once and a learning day for her streak."""
    now = now or timezone.now()
    student, lang = attempt.student, lang_of(attempt.student)
    valid = set(attempt.exam.questions.values_list("position", flat=True))
    wrong = wrong_numbers(attempt)
    prog, _ = ReviewProgress.objects.get_or_create(attempt=attempt)
    prog.seen = sorted(set(prog.seen) | {n for n in numbers if isinstance(n, int) and n in valid})
    newly = bool(wrong) and not prog.completed and set(wrong) <= set(prog.seen)
    if newly:
        prog.completed, prog.completed_at = True, now
    prog.save()
    xp_awarded = 0
    if newly:
        cfg = config()
        ev = award_xp(student, "review", cfg["xp"]["review_wrong"], f"review:{attempt.exam_id}", attempt.exam_id)
        xp_awarded = ev.points if ev else 0
        record_activity(student, timezone.localdate(now), "review", cfg)
        evaluate_badges(student, cfg)
        check_level(student, cfg)
    return {"wrong": wrong, "seen": prog.seen, "completed": prog.completed, "all_correct": not wrong,
            "xp_awarded": xp_awarded,
            "message": t("review.nothing", lang) if not wrong else (t("review.done", lang) if prog.completed else "")}


# ---------------------------------------------------------------- practice mode (SRS 5.5)

def _reserved_for_exams():
    """Source questions that sit in an exam whose results are not published yet. Never offered for practice."""
    return (ExamQuestion.objects.exclude(exam__status=Exam.PUBLISHED).filter(source__isnull=False).values("source_id"))


def _student_form(student):
    return student.school_class.form_level if student.school_class_id else None


def practice_pool(student, subject, topic=None, difficulty=None):
    """Questions a student may practise: approved, marked 'practice eligible' by a teacher, and NEVER a question that
    sits in an exam whose results are not published yet (so no exam is spoiled).
    Form: her own form first. When her own form has fewer than PRACTICE_MIN questions she is also given questions
    from LOWER forms (revision), never from a higher form, so a quiz can still be built."""
    qs = (Question.objects.filter(subject=subject, status=Question.APPROVED, practice_eligible=True)
          .exclude(pk__in=_reserved_for_exams()))
    if topic:
        qs = qs.filter(topic__iexact=topic)
    if difficulty in ("easy", "medium", "hard"):
        qs = qs.filter(difficulty=difficulty)
    level = _student_form(student)
    if level is None:
        return qs
    own = qs.filter(form_level=level)
    return own if own.count() >= PRACTICE_MIN else qs.filter(form_level__lte=level)


def practice_why_not(student, subject):
    """For a subject she cannot practise yet: the plain reason, so the screen can say what is missing.
    none = the subject has no approved questions for her form; not_shared = approved questions exist but no teacher has
    allowed them for practice; in_exams = they are all held back for upcoming exams; few = fewer than PRACTICE_MIN."""
    level = _student_form(student)
    approved = Question.objects.filter(subject=subject, status=Question.APPROVED)
    if level is not None:
        approved = approved.filter(form_level__lte=level)
    if not approved.exists():
        return "none"
    shared = approved.filter(practice_eligible=True)
    if not shared.exists():
        return "not_shared"
    if not shared.exclude(pk__in=_reserved_for_exams()).exists():
        return "in_exams"
    return "few"


def practice_subjects(student):
    """The subjects she can practise, each with her own progress there (for the rings on the practice page)."""
    done = defaultdict(list)
    for r in (PracticeSession.objects.filter(user=student, status=PracticeSession.COMPLETED).order_by("started_at")
              .values("subject_id", "correct_score", "question_count", "completed_at")):
        n = r["question_count"] or 1
        done[r["subject_id"]].append((round(r["correct_score"] / n * 100), r["completed_at"]))
    current = {s.subject_id: s for s in PracticeSession.objects.filter(user=student, status=PracticeSession.IN_PROGRESS).only("subject_id", "answers", "question_count")}
    out = []
    for s in Subject.objects.filter(practice_enabled=True):
        n = practice_pool(student, s).count()
        rows, cur = done.get(s.pk, []), current.get(s.pk)
        recent = [p for p, _ in rows[-5:]]
        out.append({"id": s.pk, "name": s.name, "available_questions": n, "can_start": n >= PRACTICE_MIN,
                    "reason": "" if n >= PRACTICE_MIN else practice_why_not(student, s),
                    "stats": {"quizzes": len(rows), "best_percent": max((p for p, _ in rows), default=None),
                              "recent_percent": round(sum(recent) / len(recent)) if recent else None,
                              "last_at": rows[-1][1] if rows else None},
                    "in_progress": {"answered": len(cur.answers), "total": cur.question_count} if cur else None})
    return out


def practice_overview(student, now=None):
    """The practice page header: today's goal, her streak, level and the badge she is closest to."""
    now = now or timezone.now()
    cfg, lang, today = config(), lang_of(student), timezone.localdate(now)
    metrics = compute_metrics(student, cfg, today)
    streak = rules.streak_status(activity_days(student), today, cfg["freezes"])
    xp_quizzes = XPEvent.objects.filter(user=student, kind="practice", created_at__date=today).count()
    closest = None
    for b in catalog.BADGES:
        if b["metric"] not in catalog.PRACTICE_METRICS:
            continue
        value, th = metrics.get(b["metric"], 0), cfg["tiers"][b["code"]]
        tier, target = rules.tier_for(value, th), rules.next_target(value, th)
        if tier >= 3 or not target:
            continue
        ratio = value / target
        if closest is None or ratio > closest[0]:
            closest = (ratio, {"code": b["code"], "name": catalog.badge_name(b["code"], lang, tier + 1), "unit": catalog.badge_unit(b["code"], lang),
                               "progress": value, "target": target, "tier": catalog.tier_key(tier + 1), "tier_label": catalog.tier_label(tier + 1, lang)})
    return {"default_count": SchoolSettings.load().practice_default_count, "xp_per_quiz": cfg["xp"]["practice_quiz"], "daily_cap": cfg["practice_cap"], "xp_quizzes_today": xp_quizzes,
            "quizzes_today": PracticeSession.objects.filter(user=student, status=PracticeSession.COMPLETED, completed_at__date=today).count(),
            "total_quizzes": metrics["practice_quizzes"], "questions_answered": metrics["questions_answered"],
            "streak": {"current": streak["current"], "best": streak["best"], "at_risk": bool(streak["at_risk"])},
            "level": level_payload(total_xp(student), cfg, lang), "next_badge": closest[1] if closest else None}


PACK_MAX_QUESTIONS = 60  # one offline pack per subject
PACK_VALID_DAYS = 14     # after this the phone drops the pack and asks for a fresh download
PACK_BATCH_MAX = 50


def practice_pack(student, subject_id, seed=None, offset=0, limit=None, now=None):
    """Everything the phone needs to run practice quizzes of one subject with NO signal: the questions with their
    answers and explanations (practice questions are never in an upcoming exam, and the phone marks them itself).
    Offline quizzes are for learning only: they never earn XP, streaks or marks.
    The phone asks in batches so it can show true progress: first limit=0 (just the heading: how many questions and a
    seed), then offset=0,10,20... with that same seed, which always picks the same questions in the same order."""
    now = now or timezone.now()
    lang = lang_of(student)
    subject = Subject.objects.filter(pk=subject_id).first()
    if subject is None:
        raise GamificationError("That subject does not exist.", 404, "not_found")
    if not subject.practice_enabled:
        raise GamificationError(t("practice.disabled", lang), 403, "practice_off")
    pool = list(practice_pool(student, subject).order_by("pk"))
    if len(pool) < PRACTICE_MIN:
        raise GamificationError(t("practice.not_enough", lang), 409, "not_enough")
    seed = seed or random.SystemRandom().randrange(1, 2**31)
    picks = random.Random(seed).sample(pool, min(PACK_MAX_QUESTIONS, len(pool)))
    chunk = picks if limit is None else picks[offset: offset + max(0, min(limit, PACK_BATCH_MAX))]
    return {
        "subject_id": subject.pk, "subject": subject.name, "seed": seed, "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=PACK_VALID_DAYS)).isoformat(), "count": len(picks), "offset": offset,
        "questions": [{"id": q.pk, "type": q.qtype, "prompt": q.prompt, "marks": q.marks, "content": q.content,
                       "answer": q.answer, "explanation": q.explanation, "topic": q.topic} for q in chunk]}


def _practice_payload(q):
    return {"qtype": q.qtype, "prompt": q.prompt, "content": q.content, "answer": q.answer, "marks": q.marks,
            "explanation": q.explanation, "topic": q.topic, "subtopic": q.subtopic, "difficulty": q.effective_difficulty,
            "language": q.language}


def _topic_mastery(student, subject):
    """{topic (lower case): 0..1} from her PUBLISHED exam results in this subject: where smart mode should spend her time."""
    got = defaultdict(lambda: [0.0, 0.0])
    for r in Result.objects.filter(student=student, exam__subject=subject, exam__status=Exam.PUBLISHED).only("topic_stats"):
        for topic, v in (r.topic_stats or {}).items():
            try:
                got[(topic or "").strip().lower()][0] += float(v[0])
                got[(topic or "").strip().lower()][1] += float(v[1])
            except (TypeError, ValueError, IndexError):
                continue
    return {k: round(e / p, 4) for k, (e, p) in got.items() if p > 0}


def _cand(q):
    return {"qid": q.pk, "d": q.effective_difficulty, "topic": q.topic}


def _smart_start(pool, count, seed, mastery):
    """Choose the opening questions greedily (ability 0 = medium) and keep the rest of a sample as the reserve to adapt from."""
    rng = random.Random(seed)
    sample = rng.sample(pool, min(len(pool), 120))
    cands, by_id, picks, recent = [_cand(q) for q in sample], {q.pk: q for q in sample}, [], []
    for _ in range(min(count, len(cands))):
        best = adapt.pick_next(0.0, cands, mastery, recent, rng)
        cands.remove(best)
        picks.append(by_id[best["qid"]])
        recent.append(best["topic"])
    return picks, {"theta": 0.0, "mastery": dict(mastery), "recent": [], "reserve": cands}


def _adapt_next(s, idx, fraction):
    """After answer number idx: update her level and topic strength, then put the best-fitting question next."""
    st = dict(s.adaptive)
    done = s.items[idx]["payload"]
    st["theta"] = round(adapt.update_theta(st.get("theta", 0.0), fraction, adapt.diff_value(done.get("difficulty"))), 4)
    st["mastery"] = adapt.update_mastery(dict(st.get("mastery", {})), done.get("topic"), fraction)
    st["recent"] = (list(st.get("recent", [])) + [done.get("topic") or ""])[-3:]
    nxt, items = idx + 1, list(s.items)
    pending = [{"qid": it["qid"], "d": it["payload"].get("difficulty"), "topic": it["payload"].get("topic")} for it in items[nxt:]]
    reserve = list(st.get("reserve", []))
    best = adapt.pick_next(st["theta"], pending + reserve, st["mastery"], st["recent"])
    if best and best["qid"] != items[nxt]["qid"]:
        pos = next((i for i, c in enumerate(pending) if c["qid"] == best["qid"]), None)
        if pos is not None:                      # already in this quiz: just move it up
            items[nxt], items[nxt + pos] = items[nxt + pos], items[nxt]
        else:                                    # from the reserve: it takes the place of the next question, which goes back
            q = Question.objects.filter(pk=best["qid"], status=Question.APPROVED, practice_eligible=True).first()
            if q:
                displaced = items[nxt]
                items[nxt] = {"qid": q.pk, "payload": _practice_payload(q)}
                reserve = [c for c in reserve if c["qid"] != q.pk] + [{"qid": displaced["qid"], "d": displaced["payload"].get("difficulty"),
                                                                       "topic": displaced["payload"].get("topic")}]
            else:
                reserve = [c for c in reserve if c["qid"] != best["qid"]]
    st["reserve"] = reserve
    s.items, s.adaptive = items, st


def start_practice(student, subject_id, count=PRACTICE_DEFAULT, topic=None, difficulty=None, restart=False, adaptive=False, now=None):
    """Start a practice quiz, or return the one she is already in the middle of. adaptive=True is smart mode (see adaptive.py)."""
    now = now or timezone.now()
    lang = lang_of(student)
    subject = Subject.objects.filter(pk=subject_id).first()
    if subject is None:
        raise GamificationError("That subject does not exist.", 404, "not_found")
    if not subject.practice_enabled:
        raise GamificationError(t("practice.disabled", lang), 403, "practice_off")
    stale = now - timedelta(hours=PRACTICE_STALE_HOURS)
    PracticeSession.objects.filter(user=student, status=PracticeSession.IN_PROGRESS, started_at__lt=stale) \
        .update(status=PracticeSession.ABANDONED)
    current = PracticeSession.objects.filter(user=student, status=PracticeSession.IN_PROGRESS, subject=subject).first()
    if current and not restart:
        return current
    if current:
        current.status = PracticeSession.ABANDONED
        current.save(update_fields=["status"])
    try:
        count = max(PRACTICE_MIN, min(PRACTICE_MAX, int(count)))
    except (TypeError, ValueError):
        count = PRACTICE_DEFAULT
    pool = list(practice_pool(student, subject, topic, difficulty))
    if len(pool) < PRACTICE_MIN:
        raise GamificationError(t("practice.not_enough", lang), 409, "not_enough")
    seed = random.SystemRandom().randrange(1, 2**31)
    state = {}
    if adaptive and not difficulty:  # a fixed difficulty asked for by hand wins over smart mode
        picks, state = _smart_start(pool, count, seed, _topic_mastery(student, subject))
    else:
        picks = random.Random(seed).sample(pool, min(count, len(pool)))
    return PracticeSession.objects.create(
        user=student, subject=subject, seed=seed, question_count=len(picks), adaptive=state,
        items=[{"qid": q.pk, "payload": _practice_payload(q)} for q in picks])


def practice_state(session):
    """What the phone shows: the current question (never its answer) or the finished summary."""
    n, done = len(session.items), len(session.answers)
    state = {"session_id": session.pk, "subject": session.subject.name, "total": n, "answered": done,
             "status": session.status}
    if session.status != PracticeSession.IN_PROGRESS or done >= n:
        state.update(finished=True, summary=practice_summary(session))
        return state
    item = session.items[done]
    if session.adaptive:  # lets the phone show "your level" and the difficulty of this question
        state["adaptive"] = {"level": adapt.level_name(session.adaptive.get("theta", 0.0)), "difficulty": item["payload"].get("difficulty", "medium")}
    state.update(finished=False, index=done + 1,
                 question=public_question(SimpleNamespace(pk=item["qid"], payload=item["payload"]), session.seed, True))
    return state


def practice_summary(session):
    n = len(session.items) or 1
    fully = sum(1 for a in session.answers if a["fraction"] >= 0.9999)
    return {"questions": len(session.items), "fully_correct": fully, "score_percent": round(session.correct_score / n * 100),
            "xp_earned": session.xp_awarded}


def _practice_feedback(session, index, lang):
    ans, item = session.answers[index], session.items[index]
    f = ans["fraction"]
    return {"question_id": ans["qid"], "fraction": f, "correct": f >= 0.9999, "your_response": ans["response"],
            "correct_answer": item["payload"]["answer"], "explanation": item["payload"].get("explanation", ""),
            "message": t("practice.correct" if f >= 0.9999 else ("practice.partly" if f > 0 else "practice.wrong"), lang)}


def answer_practice(session_id, student, question_id, response, now=None):
    """Mark one practice answer immediately and return instant feedback plus the next question (SRS 5.5)."""
    now = now or timezone.now()
    lang = lang_of(student)
    just_finished = False
    with transaction.atomic():
        s = PracticeSession.objects.select_for_update().select_related("subject").get(pk=session_id, user=student)
        if s.status != PracticeSession.IN_PROGRESS:
            raise GamificationError("This practice quiz is already finished.", 409, "finished")
        idx = len(s.answers)
        if question_id != s.items[idx]["qid"]:
            for i, a in enumerate(s.answers):  # a repeated send of an answer already marked: give the same feedback
                if a["qid"] == question_id:
                    return {"feedback": _practice_feedback(s, i, lang), "next": practice_state(s)}
            raise GamificationError("That is not the current question.", 409, "out_of_order")
        if response in (None, "", [], {}):
            raise GamificationError(t("practice.empty", lang), 400, "empty_answer")
        if len(str(response)) > 5000:
            raise GamificationError("That answer is too long.", 400, "too_long")
        fraction = marking.fraction_correct(s.items[idx]["payload"], response, partial=True)  # instant, automatic
        s.answers = s.answers + [{"qid": question_id, "response": response, "fraction": round(fraction, 4)}]
        s.correct_score = round(sum(a["fraction"] for a in s.answers), 4)
        if s.adaptive and len(s.answers) < len(s.items):
            _adapt_next(s, idx, fraction)  # the next question is chosen from how she is doing right now
        if len(s.answers) >= len(s.items):
            s.status, s.completed_at, just_finished = PracticeSession.COMPLETED, now, True
        s.save()
    out = {"feedback": _practice_feedback(s, len(s.answers) - 1, lang)}
    if just_finished:
        out["rewards"] = _finish_practice(s, student, now)
    out["next"] = practice_state(s)  # after the rewards, so the summary shows the XP just earned
    return out


def _finish_practice(session, student, now):
    """XP (up to the daily limit), a learning day for the streak, and badge checks.
    Returns what to celebrate on the summary screen: new badges, a new level, and the streak."""
    cfg = config()
    lang = lang_of(student)
    today = timezone.localdate(now)
    level_before = level_payload(total_xp(student), cfg, lang)["level"]
    earned_today = XPEvent.objects.filter(user=student, kind="practice", created_at__date=today).count()
    if earned_today < cfg["practice_cap"]:
        ev = award_xp(student, "practice", cfg["xp"]["practice_quiz"], f"practice:{session.pk}")
        if ev:
            session.xp_awarded = ev.points
            session.save(update_fields=["xp_awarded"])
    bonus = 0
    if session.daily:  # the day's challenge: a bonus once a day (the key makes a second one impossible)
        ev2 = award_xp(student, "daily", DAILY_BONUS_XP, f"daily:{today.isoformat()}")
        if ev2:
            bonus = ev2.points
            session.xp_awarded += bonus
            session.save(update_fields=["xp_awarded"])
    record_activity(student, today, "practice", cfg)  # a quiz is at least PRACTICE_MIN questions, so it counts
    new = evaluate_badges(student, cfg)
    check_level(student, cfg)
    level_after = level_payload(total_xp(student), cfg, lang)
    streak = rules.streak_status(activity_days(student), today, cfg["freezes"])
    return {"badges": [badge_brief(n["code"], n["scope"], n["tier"], lang) for n in new],
            "level_up": level_after if level_after["level"] > level_before else None,
            "streak": {"current": streak["current"], "best": streak["best"]}, "daily_bonus": bonus}


# ---------------------------------------------------------------- the day's challenge

def _daily_sessions(student, today):
    return PracticeSession.objects.filter(user=student, daily=True, started_at__date=today)


def daily_status(student, now=None):
    """Cheap enough for every home-screen load: what the challenge card shows."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    mine = list(_daily_sessions(student, today).select_related("subject").order_by("-started_at")[:3])
    done = next((s for s in mine if s.status == PracticeSession.COMPLETED), None)
    cur = next((s for s in mine if s.status == PracticeSession.IN_PROGRESS), None)
    streak = rules.streak_status(activity_days(student), today, config()["freezes"])
    return {"count": PRACTICE_MIN, "bonus_xp": DAILY_BONUS_XP, "done_today": done is not None,
            "score_percent": round(done.correct_score / (done.question_count or 1) * 100) if done else None,
            "in_progress": {"answered": len(cur.answers), "total": cur.question_count, "subject": cur.subject.name} if cur else None,
            "available": Subject.objects.filter(practice_enabled=True).exists(),
            "streak": {"current": streak["current"], "active_today": streak["active_today"], "at_risk": bool(streak["at_risk"])}}


def _daily_subject(student, now):
    """Her weakest subject (lowest average in published results) among those she can practise; with no results yet, a subject
    that rotates daily, so it is not always the same one."""
    avgs = defaultdict(list)
    for r in Result.objects.filter(student=student).select_related("attempt", "exam"):
        if exam_services.result_visible(r.attempt, now):
            avgs[r.exam.subject_id].append(r.percent)
    cands = [s for s in Subject.objects.filter(practice_enabled=True).order_by("pk") if practice_pool(student, s).count() >= PRACTICE_MIN]
    if not cands:
        return None
    rnd = random.Random(f"{student.pk}:{timezone.localdate(now)}")
    return min(cands, key=lambda s: (0, sum(avgs[s.pk]) / len(avgs[s.pk])) if avgs.get(s.pk) else (1, rnd.random()))


def start_daily(student, now=None):
    """Start (or resume) today's challenge: PRACTICE_MIN questions from her weakest subject, beginning with ones she got wrong
    before. It is a normal practice quiz (5 questions, so it also keeps her streak) with a one-time XP bonus."""
    now = now or timezone.now()
    lang, today = lang_of(student), timezone.localdate(now)
    mine = list(_daily_sessions(student, today).order_by("-started_at")[:5])
    for s in mine:
        if s.status == PracticeSession.IN_PROGRESS:
            return s
    if any(s.status == PracticeSession.COMPLETED for s in mine):
        raise GamificationError(t("daily.done", lang), 409, "daily_done")
    subject = _daily_subject(student, now)
    if subject is None:
        raise GamificationError(t("practice.not_enough", lang), 409, "not_enough")
    pool = list(practice_pool(student, subject).order_by("pk"))
    missed = set()
    for sess in PracticeSession.objects.filter(user=student, subject=subject, status=PracticeSession.COMPLETED).order_by("-started_at")[:20]:
        missed.update(a["qid"] for a in sess.answers if a.get("fraction", 1) < 0.9999)
    seed = random.SystemRandom().randrange(1, 2**31)
    rnd = random.Random(seed)
    hard = [q for q in pool if q.pk in missed]
    rnd.shuffle(hard)
    first = hard[:3]  # a mix: some she missed, the rest fresh
    rest = [q for q in pool if q not in first]
    rnd.shuffle(rest)
    picks = (first + rest)[:PRACTICE_MIN]
    rnd.shuffle(picks)
    PracticeSession.objects.filter(user=student, status=PracticeSession.IN_PROGRESS, subject=subject).update(status=PracticeSession.ABANDONED)
    return PracticeSession.objects.create(
        user=student, subject=subject, seed=seed, question_count=len(picks), daily=True,
        items=[{"qid": q.pk, "payload": _practice_payload(q)} for q in picks])


# ---------------------------------------------------------------- leaderboard (SRS 5.6)

def week_start(now=None):
    local = timezone.localtime(now or timezone.now())
    return (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def leaderboard(student, period="weekly", now=None, limit=10):
    """Class-level ranking by XP, never by exam marks. Shows display names to classmates only, leaves out
    students who chose to hide, and shows nobody with zero XP (nobody is shamed)."""
    now = now or timezone.now()
    lang = lang_of(student)
    if not SchoolSettings.load().leaderboard_enabled:
        return {"enabled": False, "message": t("leaderboard.off", lang)}
    period = "all" if period == "all" else "weekly"
    cfg = config()
    mates = list(User.objects.filter(role=User.Role.STUDENT, is_active=True, is_archived=False,
                                     school_class_id=student.school_class_id)) if student.school_class_id else []
    ids = [u.pk for u in mates]
    profiles = {p.user_id: p for p in Profile.objects.filter(user_id__in=ids)}
    hidden = {uid for uid, p in profiles.items() if p.hide_from_leaderboard}
    alltime = dict(XPEvent.objects.filter(user_id__in=ids).order_by().values_list("user_id").annotate(s=Sum("points")))
    if period == "weekly":
        totals = dict(XPEvent.objects.filter(user_id__in=ids, created_at__gte=week_start(now))
                      .order_by().values_list("user_id").annotate(s=Sum("points")))
    else:
        totals = alltime
    shown = [u for u in mates if u.pk not in hidden and totals.get(u.pk, 0) > 0]
    shown.sort(key=lambda u: (-totals[u.pk], display_name(u, profiles.get(u.pk)).lower()))
    ranked, last_xp, last_rank = [], None, 0
    for i, u in enumerate(shown, start=1):
        xp = totals[u.pk]
        rank = last_rank if xp == last_xp else i  # equal XP shares a rank
        last_xp, last_rank = xp, rank
        ranked.append((rank, u, xp))
    mine = next((r for r in ranked if r[1].pk == student.pk), None)
    my_xp = totals.get(student.pk, 0)
    you = {"hidden": student.pk in hidden, "xp": my_xp, "rank": mine[0] if mine else None, "message": ""}
    if you["hidden"]:
        you["message"] = t("leaderboard.hidden", lang)
    elif not mine:
        you["message"] = t("leaderboard.unranked", lang)
    entries = []
    for rank, u, xp in ranked[:limit]:
        p = profiles.get(u.pk)
        axp = alltime.get(u.pk, 0)
        lv = level_payload(axp, cfg, lang)["level"]
        entries.append({"rank": rank, "name": display_name(u, p), "xp": xp, "avatar": p.avatar if p else AVATARS[0],
                        "level": lv, "is_me": u.pk == student.pk,
                        "frame": p.frame if p and FRAMES.get(p.frame, 99) <= lv else "ring",
                        "title": title_for(p, axp, cfg, lang) if p else ""})
    return {"enabled": True, "scope": "class", "period": period,
            "week_start": week_start(now) if period == "weekly" else None,
            "class_name": str(student.school_class) if student.school_class_id else None,
            "you": you, "entries": entries}


# ---------------------------------------------------------------- the student's home summary (HOME-03)

def student_summary(student, now=None):
    now = now or timezone.now()
    cfg, lang, today = config(), lang_of(student), timezone.localdate(now)
    profile = get_profile(student)
    xp = total_xp(student)
    lvl = level_payload(xp, cfg, lang)
    streak = rules.streak_status(activity_days(student), today, cfg["freezes"])
    exam_cur, exam_best = exam_streak(student)
    recent = [badge_brief(b.code, b.scope, b.tier, lang) | {"new": not b.seen} for b in BadgeAward.objects.filter(user=student)[:3]]
    cabinet = badge_cabinet(student, cfg, lang)
    goals = sorted((c for c in cabinet if c["next_target"]), key=lambda c: -(c["progress"] / c["next_target"]))[:3]
    message = ""
    if streak["current"] == 0 and streak["best"] > 0:
        message = t("streak.restart", lang)
    elif streak["at_risk"]:
        message = t("streak.keep", lang)
    return {
        "xp": xp, "level": lvl,
        "level_up": ({"from": profile.last_seen_level, "to": lvl["level"], "name": lvl["name"]}
                     if lvl["level"] > profile.last_seen_level else None),
        "streak": {**streak, "message": message},
        "exam_streak": {"current": exam_cur, "best": exam_best},
        "recent_badges": recent, "new_badges": BadgeAward.objects.filter(user=student, seen=False).count(),
        "next_goals": [{"code": g["code"], "name": g["name"], "subject": g["subject"], "progress": g["progress"],
                        "target": g["next_target"], "unit": g["unit"]} for g in goals],
        "leaderboard_enabled": SchoolSettings.load().leaderboard_enabled,
        "profile": profile_payload(profile, xp, cfg, lang_of(student)),
    }


def title_for(profile, xp, cfg, lang="en"):
    """The title she shows: the name of the level she picked (never one she has not reached), else her current level's name."""
    reached = level_payload(xp, cfg, lang)["level"]
    want = profile.title_level if profile.title_level and profile.title_level <= reached else reached
    row = next((lv for lv in level_table(cfg) if lv["level"] == want), None)
    return (row["name_sw"] if lang == "sw" else row["name"]) if row else ""


def profile_payload(profile, xp=None, cfg=None, lang="en"):
    """`xp`/`cfg` are passed by callers that already have them (the home summary); otherwise they are looked up."""
    cfg = cfg or config()
    xp = total_xp(profile.user) if xp is None else xp
    reached = level_payload(xp, cfg, lang)["level"]
    frame = profile.frame if FRAMES.get(profile.frame, 99) <= reached else "ring"  # a frame whose level she has lost access to falls back
    return {"avatar": profile.avatar, "display_name": profile.display_name, "hide_from_leaderboard": profile.hide_from_leaderboard,
            "avatars": AVATARS, "photo": photo_url(profile), "photos_enabled": SchoolSettings.load().student_photos_enabled,
            "frame": frame, "frames": [{"key": k, "level": lv, "unlocked": lv <= reached} for k, lv in FRAMES.items()],
            "title": title_for(profile, xp, cfg, lang), "title_level": profile.title_level,
            "titles": [{"level": lv["level"], "name": lv["name_sw"] if lang == "sw" else lv["name"]} for lv in level_table(cfg) if lv["level"] <= reached],
            "goal_percent": profile.goal_percent, "goal_subject": profile.goal_subject}


# ---------------------------------------------------------------- profile photo

PHOTO_SIZE = 480                  # pixels, square: sharp on a big screen, a few tens of KB on a phone
PHOTO_MAX_BYTES = 8 * 1024 * 1024


def photo_url(profile):
    try:
        return profile.photo.url if profile and profile.photo else ""
    except ValueError:
        return ""


def set_photo(profile, f):
    """Keep the student's photo: any JPG, PNG or WebP is turned into a square JPEG (the web app already crops it, this makes sure),
    rotated the way the phone meant it, with all hidden data (such as GPS position) removed. The old photo file is deleted."""
    import io
    import uuid

    from django.core.files.base import ContentFile
    from PIL import Image, ImageOps

    from core.images import BadImage, open_image

    if f.size > PHOTO_MAX_BYTES:
        raise GamificationError("That photo is too large (max 8 MB). Choose a smaller one.")
    try:
        img = open_image(f, invalid="That file is not a photo we can read. Use a JPG, PNG or WebP picture.")
    except BadImage as e:
        raise GamificationError(str(e))
    if img.format not in ("JPEG", "PNG", "WEBP"):
        raise GamificationError("Only JPG, PNG and WebP photos are allowed.")
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        flat = Image.new("RGB", img.size, "white")  # a see-through PNG gets a white background instead of black
        flat.paste(img, mask=img.split()[-1])
        img = flat
    else:
        img = img.convert("RGB")
    img = ImageOps.fit(img, (PHOTO_SIZE, PHOTO_SIZE), Image.LANCZOS, centering=(0.5, 0.4))  # a little above the middle: faces
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=True)  # a new file, so nothing from the original is carried over
    old = profile.photo.name if profile.photo else ""
    profile.photo.save(f"{uuid.uuid4().hex}.jpg", ContentFile(buf.getvalue()), save=False)  # unguessable name: /media/ needs no login
    profile.save(update_fields=["photo"])
    if old:
        profile.photo.storage.delete(old)


def remove_photo(profile):
    old = profile.photo.name if profile.photo else ""
    if old:
        profile.photo = ""
        profile.save(update_fields=["photo"])
        profile.photo.storage.delete(old)


def acknowledge(student):
    """The student has seen her celebrations (new badges and the level-up)."""
    cfg = config()
    BadgeAward.objects.filter(user=student, seen=False).update(seen=True)
    profile = get_profile(student)
    profile.last_seen_level = rules.level_for(total_xp(student), cfg["levels"])["level"]
    profile.save(update_fields=["last_seen_level"])


def xp_history(student, limit=50, offset=0):
    lang = lang_of(student)
    qs = XPEvent.objects.filter(user=student)
    return {"total": total_xp(student), "count": qs.count(),
            "results": [{"at": e.created_at, "points": e.points, "kind": e.kind, "label": xp_label(e, lang)}
                        for e in qs[offset:offset + limit]]}


# ---------------------------------------------------------------- staff views of engagement (TCH-03, ADM-08)

def engagement_for(student_ids, subject_id=None, now=None):
    """Streak, XP and practice activity for some students: {student_id: {...}}. For teachers, pass the
    subject so only practice in that subject is shown. Contains no marks."""
    now = now or timezone.now()
    today, cfg = timezone.localdate(now), config()
    ids = list(student_ids)
    days = defaultdict(list)
    for uid, d in ActivityDay.objects.filter(user_id__in=ids).values_list("user_id", "day"):
        days[uid].append(d)
    xp = dict(XPEvent.objects.filter(user_id__in=ids).order_by().values_list("user_id").annotate(s=Sum("points")))
    sessions = PracticeSession.objects.filter(user_id__in=ids, status=PracticeSession.COMPLETED)
    if subject_id:
        sessions = sessions.filter(subject_id=subject_id)
    total, recent, score, count, last = Counter(), Counter(), defaultdict(float), Counter(), {}
    for uid, done, scored, n in sessions.values_list("user_id", "completed_at", "correct_score", "question_count"):
        total[uid] += 1
        recent[uid] += 1 if done and done >= now - timedelta(days=30) else 0
        if n:
            score[uid] += scored / n * 100
            count[uid] += 1
        if done and (uid not in last or done > last[uid]):
            last[uid] = done
    out = {}
    for uid in ids:
        st = rules.streak_status(days.get(uid, []), today, cfg["freezes"])
        out[uid] = {
            "current_streak": st["current"], "best_streak": st["best"],
            "active_days_last_30": sum(1 for d in days.get(uid, []) if d >= today - timedelta(days=29)),
            "total_xp": xp.get(uid, 0),
            "practice_sessions": total[uid], "practice_sessions_last_30_days": recent[uid],
            "practice_average_percent": round(score[uid] / count[uid]) if count[uid] else None,
            "last_practice_at": last.get(uid),
        }
    return out


def school_engagement(now=None):
    """ADM-08: engagement across the school (streaks, XP, practice). Numbers only, no marks."""
    now = now or timezone.now()
    today, cfg = timezone.localdate(now), config()
    base = User.objects.filter(role=User.Role.STUDENT, is_active=True, is_archived=False)
    students = list(base.values_list("pk", "school_class_id"))
    days = defaultdict(list)
    for uid, d in ActivityDay.objects.filter(user__in=base).values_list("user_id", "day"):
        days[uid].append(d)
    xp = dict(XPEvent.objects.filter(user__in=base).order_by().values_list("user_id").annotate(s=Sum("points")))
    week_ago = today - timedelta(days=6)
    labels = {c.pk: str(c) for c in SchoolClass.objects.all()}
    per_class = defaultdict(lambda: {"students": 0, "xp": 0, "streaks": 0, "active7": 0})
    streak7 = total_streak = active7 = 0
    for uid, class_id in students:
        st = rules.streak_status(days.get(uid, []), today, cfg["freezes"])
        row = per_class[class_id]
        row["students"] += 1
        row["xp"] += xp.get(uid, 0)
        row["streaks"] += st["current"]
        total_streak += st["current"]
        streak7 += 1 if st["current"] >= 7 else 0
        if any(d >= week_ago for d in days.get(uid, [])):
            row["active7"] += 1
            active7 += 1
    by_class = [{"class": labels.get(cid, "(no class)"), "students": r["students"], "total_xp": r["xp"],
                 "average_xp": round(r["xp"] / r["students"]) if r["students"] else 0,
                 "average_current_streak": round(r["streaks"] / r["students"], 1) if r["students"] else 0,
                 "active_last_7_days": r["active7"]} for cid, r in sorted(per_class.items(), key=lambda kv: labels.get(kv[0], ""))]
    practice = (PracticeSession.objects.filter(status=PracticeSession.COMPLETED, completed_at__gte=now - timedelta(days=30))
                .order_by().values("subject__name").annotate(n=Count("id")))
    n = len(students)
    return {
        "available": True, "students": n, "active_last_7_days": active7,
        "active_rate_last_7_days": round(active7 / n * 100, 1) if n else None,
        "average_current_streak": round(total_streak / n, 1) if n else 0, "students_with_7_day_streak": streak7,
        "total_xp": sum(xp.values()), "by_class": by_class,
        "practice_sessions_last_30_days": sum(p["n"] for p in practice),
        "practice_by_subject": sorted(({"subject": p["subject__name"], "sessions": p["n"]} for p in practice),
                                      key=lambda x: -x["sessions"]),
    }
