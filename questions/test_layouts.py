"""Matching and fill-in-the-blank: the teacher's layout/marking settings are validated, kept and applied."""
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from exams.marking import fraction_correct
from .validation import validate_question

L = [{"id": "l1", "text": "Mouse"}, {"id": "l2", "text": "Monitor"}]
R = [{"id": "r1", "text": "Input"}, {"id": "r2", "text": "Output"}, {"id": "r3", "text": "Storage"}]


class MatchingTests(SimpleTestCase):
    def check(self, layout=None, pairs=None, **answer):
        content = {"left": L, "right": R}
        if layout is not None:
            content["layout"] = layout
        return validate_question("matching", content, {"pairs": pairs or {"l1": "r1", "l2": "r2"}, **answer})

    def test_defaults_are_roman_left_and_letters_right(self):
        c, a = self.check()
        self.assertEqual((c["layout"]["left_style"], c["layout"]["right_style"]), ("roman", "LETTER"))
        self.assertTrue(c["layout"]["shuffle_right"])
        self.assertIsNone(a["partial"])

    def test_settings_are_kept_and_cleaned(self):
        c, a = self.check({"left_style": "ROMAN", "right_style": "letter", "left_title": "<b>Device</b>", "right_title": "Job",
                           "shuffle_right": False, "unique": True}, partial="per_pair")
        self.assertEqual(c["layout"], {"left_style": "ROMAN", "right_style": "letter", "left_title": "Device", "right_title": "Job",
                                       "shuffle_right": False, "unique": True})
        self.assertEqual(a["partial"], "per_pair")

    def test_unknown_values_fall_back(self):
        c, a = self.check({"left_style": "wild", "right_style": "x"}, partial="maybe")
        self.assertEqual((c["layout"]["left_style"], c["layout"]["right_style"], a["partial"]), ("roman", "LETTER", None))

    def test_once_only_rejects_a_repeated_match(self):
        with self.assertRaises(ValidationError):
            self.check({"unique": True}, pairs={"l1": "r1", "l2": "r1"})

    def test_a_question_can_choose_its_own_partial_credit(self):
        resp = {"l1": "r1", "l2": "r3"}
        base = {"qtype": "matching", "answer": {"pairs": {"l1": "r1", "l2": "r2"}}}
        self.assertEqual(fraction_correct(base, resp, partial=True), 0.5)
        self.assertEqual(fraction_correct({**base, "answer": {**base["answer"], "partial": "all"}}, resp, partial=True), 0.0)
        self.assertEqual(fraction_correct({**base, "answer": {**base["answer"], "partial": "per_pair"}}, resp, partial=False), 0.5)


class FillBlankTests(SimpleTestCase):
    def test_layout_and_marking_options_are_kept(self):
        c, a = validate_question("fill_blank", {"unit": "cm", "hint": "One word", "input": "number", "width": "short"},
                                 {"accepted": ["Nairobi"], "case_sensitive": True, "ignore_punct": True})
        self.assertEqual(c, {"unit": "cm", "hint": "One word", "input": "number", "width": "short"})
        self.assertTrue(a["case_sensitive"] and a["ignore_punct"])

    def test_defaults(self):
        c, a = validate_question("fill_blank", {}, {"accepted": ["x"]})
        self.assertEqual((c["input"], c["width"]), ("text", "medium"))
        self.assertFalse(a["case_sensitive"] or a["ignore_punct"])

    def test_case_sensitive_marking(self):
        p = {"qtype": "fill_blank", "answer": {"accepted": ["HTML"], "case_sensitive": True}}
        self.assertEqual(fraction_correct(p, "HTML"), 1.0)
        self.assertEqual(fraction_correct(p, "html"), 0.0)
        p["answer"]["case_sensitive"] = False
        self.assertEqual(fraction_correct(p, " html "), 1.0)

    def test_ignoring_punctuation(self):
        p = {"qtype": "fill_blank", "answer": {"accepted": ["e-mail"], "ignore_punct": True}}
        self.assertEqual(fraction_correct(p, "email."), 1.0)
        p["answer"]["ignore_punct"] = False
        self.assertEqual(fraction_correct(p, "email"), 0.0)


class MinusSignTests(SimpleTestCase):
    def test_symbol_pad_minus_equals_keyboard_hyphen(self):
        p = {"qtype": "fill_blank", "answer": {"accepted": ["-5"], "numeric": {"value": -5, "tolerance": 0}}}
        self.assertEqual(fraction_correct(p, "\u22125"), 1.0)
        self.assertEqual(fraction_correct({"qtype": "fill_blank", "answer": {"numeric": {"value": -5, "tolerance": 0}}}, "\u22125"), 1.0)
