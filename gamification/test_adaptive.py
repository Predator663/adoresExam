"""Tests for smart (adaptive) practice. They need NO Django:   python -m unittest gamification.test_adaptive"""
import random
import unittest

from . import adaptive as a


def pool(n=60, seed=1):
    r = random.Random(seed)
    return [{"qid": i, "d": r.choice(["easy", "medium", "hard"]), "topic": r.choice(["Algebra", "Geometry", "Sets", "Statistics"])} for i in range(n)]


def run(p_right, n=10, mastery=None, seed=7):
    """A simulated student: answers a question right with probability p_right(d). Returns the difficulties she was asked."""
    rng, cands, theta, m, recent, asked = random.Random(seed), pool(), 0.0, dict(mastery or {}), [], []
    for _ in range(n):
        q = a.pick_next(theta, cands, m, recent, rng)
        cands.remove(q)
        asked.append(a.diff_value(q["d"]))
        f = 1.0 if rng.random() < p_right(a.diff_value(q["d"])) else 0.0
        theta = a.update_theta(theta, f, a.diff_value(q["d"]))
        a.update_mastery(m, q["topic"], f)
        recent = (recent + [q["topic"]])[-3:]
    return asked, theta


class AdaptiveTests(unittest.TestCase):
    def test_ability_moves_the_right_way(self):
        self.assertGreater(a.update_theta(0, 1.0, 1.0), a.update_theta(0, 1.0, -1.0))   # beating a hard question lifts more
        self.assertLess(a.update_theta(0, 0.0, -1.0), a.update_theta(0, 0.0, 1.0))      # missing an easy one drops more
        self.assertEqual(a.update_theta(1.5, 1.0, -1.0) <= a.THETA_MAX, True)
        self.assertEqual(a.update_theta(-1.5, 0.0, 1.0) >= a.THETA_MIN, True)

    def test_strong_student_is_pushed_up_and_weak_student_is_eased(self):
        strong, th_s = run(lambda d: 0.95)
        weak, th_w = run(lambda d: 0.15)
        self.assertGreater(th_s, 0.5)
        self.assertLess(th_w, -0.5)
        self.assertGreater(sum(strong[5:]) / 5, sum(weak[5:]) / 5 + 0.8)  # the second half of the quiz is clearly harder for the strong one

    def test_weak_topic_is_preferred(self):
        c = [{"qid": 1, "d": "medium", "topic": "Algebra"}, {"qid": 2, "d": "medium", "topic": "Sets"}]
        self.assertEqual(a.pick_next(0.0, c, {"algebra": 0.9, "sets": 0.1}, [], random.Random(1))["qid"], 2)

    def test_same_topic_three_times_in_a_row_is_avoided(self):
        c = [{"qid": 1, "d": "medium", "topic": "Sets"}, {"qid": 2, "d": "medium", "topic": "Algebra"}]
        self.assertEqual(a.pick_next(0.0, c, {"sets": 0.45, "algebra": 0.5}, ["Sets", "Sets"], random.Random(1))["qid"], 2)

    def test_empty_pool(self):
        self.assertIsNone(a.pick_next(0.0, [], {}, []))

    def test_level_names(self):
        self.assertEqual([a.level_name(x) for x in (-1.2, 0.0, 1.2)], ["easy", "medium", "hard"])


if __name__ == "__main__":
    unittest.main()
