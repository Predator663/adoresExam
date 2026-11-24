"""Tests for measured difficulty. They need NO Django:   python -m unittest questions.test_calibration
The simulation knows each question's TRUE difficulty, so we can check the model recovers it, also when hard questions
were mostly given to strong students (which fools a plain percent-correct)."""
import math
import random
import unittest

from . import calibration as c


def simulate(seed=3, per_form=45, students_per_form=70, answers_each=30, biased=True):
    """Four forms; each form's questions are centred on that form's level, so 'hard for Form 1' is not 'hard for Form 4'."""
    rng = random.Random(seed)
    resp, truth, form_of_q, form_of_s, ability = [], {}, {}, {}, {}
    for f in range(1, 5):
        qs = []
        for i in range(per_form):
            q = (f, i)
            truth[q] = rng.gauss(0.3 * f, 1.0)   # later forms are somewhat harder in absolute terms
            form_of_q[q] = f
            qs.append(q)
        for j in range(students_per_form):
            s = (f, j)
            ability[s] = rng.gauss(0.3 * f, 0.9)
            form_of_s[s] = f
            if biased:  # strong students are given harder questions: a weighted draw
                w = [math.exp(1.2 * ability[s] * truth[q]) for q in qs]
                chosen = set()
                while len(chosen) < answers_each:
                    chosen.add(rng.choices(qs, weights=w)[0])
            else:
                chosen = rng.sample(qs, answers_each)
            for q in chosen:
                resp.append((s, q, 1.0 if rng.random() < c.sigmoid(ability[s] - truth[q]) else 0.0))
    return resp, truth, form_of_q, form_of_s, ability


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return cov / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


class RaschTests(unittest.TestCase):
    def test_recovers_true_difficulty_and_beats_percent_correct_under_selection_bias(self):
        resp, truth, _, _, _ = simulate()
        theta, items, _ = c.fit_rasch(resp)
        qs = sorted(items)
        est = [items[q]["b"] for q in qs]
        raw = [-items[q]["p_obs"] for q in qs]
        tru = [truth[q] for q in qs]
        # difficulty is only comparable inside a form here (each form is its own linked group), so compare within each form
        r_model = [corr([items[q]["b"] for q in qs if q[0] == f], [truth[q] for q in qs if q[0] == f]) for f in range(1, 5)]
        r_raw = [corr([-items[q]["p_obs"] for q in qs if q[0] == f], [truth[q] for q in qs if q[0] == f]) for f in range(1, 5)]
        self.assertGreater(min(r_model), 0.85)
        self.assertGreater(sum(r_model), sum(r_raw))  # adjusting for who answered is better than raw percent correct

    def test_few_answers_are_pulled_toward_the_middle(self):
        resp = [(s, "rare", 0.0) for s in range(3)] + [(s, "common", 0.0) for s in range(60)] + [(s, "ok", 1.0) for s in range(60)]
        _, items, _ = c.fit_rasch(resp)
        self.assertLess(abs(items["rare"]["b"]), abs(items["common"]["b"]) + 3)  # sanity: finite
        self.assertGreater(items["rare"]["se"], items["common"]["se"])            # and honestly less certain

    def test_each_group_is_centred_on_its_own(self):
        resp = [(1, "a", 1.0), (2, "a", 0.0), (3, "b", 1.0), (4, "b", 0.0)]  # two groups that never meet
        _, items, _ = c.fit_rasch(resp)
        self.assertNotEqual(items["a"]["comp"], items["b"]["comp"])

    def test_labels_follow_the_class_level(self):
        resp, truth, fq, fs, ability = simulate(biased=False)
        theta, items, comp_s = c.fit_rasch(resp)
        right = 0
        for q, it in items.items():
            cohort = [theta[s] for s in theta if fs[s] == fq[q] and comp_s[s] == it["comp"]]
            est = c.label_for(c.cohort_p(it["b"], cohort))
            true = c.label_for(c.cohort_p(truth[q], [a for s, a in ability.items() if fs[s] == fq[q]]))
            right += est == true
        self.assertGreater(right / len(items), 0.75)


class ColdStartTests(unittest.TestCase):
    def rows(self, signal, n=160, seed=5):
        rng = random.Random(seed)
        out = []
        for _ in range(n):
            words, digits = rng.randint(4, 60), rng.randint(0, 12)
            qt = rng.choice(c.QTYPES)
            b = rng.gauss(0, 0.5) + (signal * (0.04 * words + 0.12 * digits - 1.2 + (0.6 if qt in ("matching", "ordering") else 0)))
            prompt = " ".join(["word"] * words) + "1" * digits
            out.append({"b": b, "topic": rng.choice(["A", "B", "C"]), "qtype": qt, "prompt": prompt, "marks": rng.randint(1, 5), "form_level": rng.randint(1, 4), "n_options": 4})
        return out

    def test_used_when_wording_really_predicts_difficulty(self):
        m = c.train_predictor(self.rows(signal=1.0))
        self.assertTrue(m["usable"])
        self.assertLess(m["mae"], m["baseline_mae"])

    def test_not_used_when_it_is_just_noise(self):
        m = c.train_predictor(self.rows(signal=0.0))
        self.assertFalse(m["usable"])  # it must not pretend

    def test_too_little_data(self):
        self.assertFalse(c.train_predictor(self.rows(signal=1.0, n=10))["usable"])


if __name__ == "__main__":
    unittest.main()
