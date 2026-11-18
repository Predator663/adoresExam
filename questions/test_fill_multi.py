import random

from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from exams import marking
from exams.presenters import public_question
from exams.sections import letters
from .validation import validate_question

PROMPT = "<p>Amina is [[1]] to school while carrying [[2]] and when asked to [[3]] she refused.</p>"
ANSWER = {"blanks": {"1": {"accepted": ["walking", "going"]}, "2": {"accepted": ["a bag"]}, "3": {"accepted": ["sing"]}}}


class FillMultiValidationTests(SimpleTestCase):
    def ok(self, content=None, answer=None, prompt=PROMPT):
        return validate_question("fill_multi", content or {}, answer or ANSWER, prompt)

    def test_typed_blanks(self):
        c, a = self.ok()
        self.assertEqual([b["id"] for b in c["blanks"]], ["1", "2", "3"])
        self.assertEqual((c["mode"], c["bank"]), ("type", []))
        self.assertEqual(a["blanks"]["1"]["accepted"], ["walking", "going"])

    def test_word_bank_is_the_first_answers_plus_wrong_words(self):
        c, a = self.ok({"mode": "bank"}, {**ANSWER, "distractors": ["running", "Running", "a book", ""]})
        self.assertEqual([w["text"] for w in c["bank"]], ["walking", "a bag", "sing", "running", "a book"])
        self.assertEqual(a["distractors"], ["running", "a book"])  # no repeats, no empties
        self.assertNotIn("distractors", c)  # the list of wrong words never goes to students

    def test_a_wrong_word_cannot_also_be_correct(self):
        with self.assertRaises(ValidationError):
            self.ok({"mode": "bank"}, {**ANSWER, "distractors": ["Going"]})

    def test_problems_are_refused(self):
        with self.assertRaises(ValidationError):
            self.ok(prompt="<p>No blank here</p>")
        with self.assertRaises(ValidationError):
            self.ok(answer={"blanks": {"1": {"accepted": ["a"]}, "2": {"accepted": []}, "3": {"accepted": ["c"]}}})
        with self.assertRaises(ValidationError):
            self.ok(prompt="<p>[[1]] and [[1]]</p>", answer={"blanks": {"1": {"accepted": ["a"]}}})


def payload(mode="type", **extra):
    c, a = validate_question("fill_multi", {"mode": mode}, {**ANSWER, "distractors": ["running"] if mode == "bank" else [], **extra}, PROMPT)
    return {"qtype": "fill_multi", "prompt": PROMPT, "marks": 3, "content": c, "answer": a}


class FillMultiMarkingTests(SimpleTestCase):
    def test_typed_all_right_and_alternatives_and_case(self):
        p = payload()
        self.assertEqual(marking.fraction_correct(p, {"1": " Going ", "2": "A  BAG", "3": "sing"}), 1.0)

    def test_partial_follows_the_exam_unless_the_question_says(self):
        p, r = payload(), {"1": "walking", "2": "a bag", "3": "dance"}
        self.assertEqual(marking.fraction_correct(p, r, partial=False), 0.0)
        self.assertAlmostEqual(marking.fraction_correct(p, r, partial=True), 2 / 3)
        self.assertAlmostEqual(marking.fraction_correct(payload(partial="per_blank"), r, partial=False), 2 / 3)
        self.assertEqual(marking.fraction_correct(payload(partial="all"), r, partial=True), 0.0)

    def test_blank_or_missing_blanks_score_nothing(self):
        p = payload()
        self.assertEqual(marking.fraction_correct(p, {"1": "walking"}, partial=True), 1 / 3)
        self.assertEqual(marking.fraction_correct(p, "walking", partial=True), 0.0)
        self.assertEqual(marking.fraction_correct(p, {}, partial=True), 0.0)

    def test_bank_responses_are_word_ids(self):
        p = payload("bank")
        ids = {w["text"]: w["id"] for w in p["content"]["bank"]}
        self.assertEqual(marking.fraction_correct(p, {"1": ids["walking"], "2": ids["a bag"], "3": ids["sing"]}), 1.0)
        self.assertEqual(marking.fraction_correct(p, {"1": ids["running"], "2": ids["a bag"], "3": ids["sing"]}, partial=False), 0.0)

    def test_marks_are_a_share_of_the_question(self):
        p = payload()
        self.assertEqual(marking.marks_for(p, {"1": "walking", "2": "a bag", "3": "x"}, partial=True, negative=False, negative_fraction=0), 2.0)


class _EQ:  # the little of an ExamQuestion the presenter needs
    def __init__(self, p):
        self.pk, self.payload = 7, p


class FillMultiStudentViewTests(SimpleTestCase):
    def test_bank_is_shuffled_and_no_answers_are_sent(self):
        p = payload("bank")
        seen = set()
        for seed in range(30):
            v = public_question(_EQ(p), seed, True)
            self.assertTrue(v["content"]["bank_shuffled"])
            self.assertEqual(sorted(w["text"] for w in v["content"]["bank"]), sorted(w["text"] for w in p["content"]["bank"]))
            seen.add(tuple(w["id"] for w in v["content"]["bank"]))
            self.assertNotIn("answer", v)
            self.assertNotIn("distractors", v["content"])
        self.assertGreater(len(seen), 3)

    def test_it_has_its_own_paper_section(self):
        self.assertEqual(letters(["fill_blank", "fill_multi", "mcq_single"]), {"mcq_single": "A", "fill_blank": "B", "fill_multi": "C"})
