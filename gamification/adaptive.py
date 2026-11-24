"""Adaptive practice ("smart mode"): after every answer the next question is chosen to fit the student right now.

Pure functions, no database, so they are easy to test. Two ideas, both small on purpose:
- Ability (theta) on the difficulty scale easy = -1, medium = 0, hard = +1. After each answer it moves like an Elo rating:
  beat a question you were expected to miss and it rises a lot; miss an easy one and it falls a lot.
- Topic mastery (0..1): topics she is weakest at are preferred, so the quiz spends its time where it helps most.
The next question is the one whose difficulty is just above her level (the "stretch zone") from her weakest topics,
without asking the same topic three times in a row.
"""
import math
import random

DIFF = {"easy": -1.0, "medium": 0.0, "hard": 1.0}
THETA_MIN, THETA_MAX = -1.5, 1.5
STRETCH = 0.15       # aim a little above her level
K = 0.6              # how fast ability moves
SLOPE = 1.5
TOPIC_WEIGHT = 0.8   # how much a weak topic is worth against a perfect difficulty fit
MASTERY_KEEP = 0.6   # in-quiz mastery update: 60% old, 40% this answer


def diff_value(difficulty):
    return DIFF.get(difficulty, 0.0)


def expected(theta, d):
    """Chance (0..1) that she answers a question of difficulty d right when her level is theta."""
    return 1.0 / (1.0 + math.exp(-SLOPE * (theta - d)))


def update_theta(theta, fraction, d):
    return max(THETA_MIN, min(THETA_MAX, theta + K * (fraction - expected(theta, d))))


def update_mastery(mastery, topic, fraction):
    key = (topic or "").strip().lower()
    old = mastery.get(key, 0.5)
    mastery[key] = round(MASTERY_KEEP * old + (1 - MASTERY_KEEP) * fraction, 4)
    return mastery


def score(theta, cand, mastery, recent_topics):
    topic = (cand.get("topic") or "").strip().lower()
    fit = -abs(diff_value(cand.get("d")) - (theta + STRETCH))
    need = TOPIC_WEIGHT * (1.0 - mastery.get(topic, 0.5))
    repeat = -0.5 if recent_topics[-2:].count(topic) == 2 else 0.0
    return fit + need + repeat


def pick_next(theta, candidates, mastery, recent_topics, rng=None):
    """candidates: [{"qid", "d" (easy|medium|hard), "topic"}]. Returns the best one, or None when there is none."""
    if not candidates:
        return None
    rng = rng or random
    recent = [(t or "").strip().lower() for t in recent_topics]
    return max(candidates, key=lambda c: score(theta, c, mastery, recent) + rng.random() * 0.15)


def level_name(theta):
    """For the little indicator on screen."""
    return "easy" if theta < -0.4 else "hard" if theta > 0.4 else "medium"
