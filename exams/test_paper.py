"""Home packages (paper exams): unique codes, scanning, keying in the answers, auto-marking.
Run:  python manage.py test exams.test_paper"""
from datetime import timedelta
from types import SimpleNamespace

from django.test import SimpleTestCase
from django.utils import timezone

from . import paper
from .models import Answer, Attempt, Exam, ExamQuestion, PaperSheet, Result
from .services import ExamError
from .tests import Base, mcq


class PaperTests(Base):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.exam.start_at, self.exam.end_at, self.exam.status = now - timedelta(hours=1), now + timedelta(hours=2), Exam.LIVE
        self.exam.save()
        ExamQuestion.objects.filter(exam=self.exam).delete()
        self.q1 = ExamQuestion.objects.create(exam=self.exam, position=1, payload=mcq(correct="b"))
        self.q2 = ExamQuestion.objects.create(exam=self.exam, position=2, payload=mcq(correct="b"))
        self.api = self.client_for(self.admin)

    def make(self, *students):
        r = self.api.post(f"/api/exams/{self.exam.pk}/paper-sheets/", {"students": [s.pk for s in students]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        return {row["student_id"]: row["code"] for row in r.json()}

    def keyed(self, code, a="b", b="b"):
        return self.api.post("/api/paper/answers/", {"code": code, "answers": {str(self.q1.pk): a, str(self.q2.pk): b}}, format="json")

    # ---- the codes
    def test_each_student_gets_her_own_code_and_keeps_it(self):
        codes = self.make(self.amina, self.zawadi)
        a, z = codes[self.amina.pk], codes[self.zawadi.pk]
        self.assertNotEqual(a, z)
        self.assertEqual((len(a), len(z)), (8, 8))
        self.assertEqual(self.make(self.amina)[self.amina.pk], a)  # printing again never changes the code on the paper already handed out
        self.assertEqual(PaperSheet.objects.count(), 2)

    def test_only_a_started_exam_can_be_printed(self):
        Exam.objects.filter(pk=self.exam.pk).update(status=Exam.SCHEDULED, start_at=timezone.now() + timedelta(hours=3), end_at=timezone.now() + timedelta(hours=4))
        r = self.api.post(f"/api/exams/{self.exam.pk}/paper-sheets/", {"students": [self.amina.pk]}, format="json")
        self.assertEqual(r.status_code, 409)

    def test_only_administrators(self):
        s = self.client_for(self.amina)
        self.assertEqual(s.get(f"/api/exams/{self.exam.pk}/paper-package/").status_code, 403)
        self.assertEqual(s.post("/api/paper/scan/", {"code": "ABCDEFGH"}, format="json").status_code, 403)

    def test_a_student_who_is_not_in_the_exam_is_refused(self):
        other = type(self.amina).objects.create(username="outsider", role="student", index_number="S9")
        r = self.api.post(f"/api/exams/{self.exam.pk}/paper-sheets/", {"students": [other.pk]}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_a_student_who_already_sat_online_gets_no_paper(self):
        now = timezone.now()
        Attempt.objects.create(exam=self.exam, student=self.amina, status=Attempt.SUBMITTED, started_at=now, deadline_at=now, submitted_at=now)
        r = self.api.post(f"/api/exams/{self.exam.pk}/paper-sheets/", {"students": [self.amina.pk]}, format="json")
        self.assertEqual(r.status_code, 409)

    def test_the_printed_paper_never_contains_the_answers(self):
        r = self.api.get(f"/api/exams/{self.exam.pk}/paper-package/")
        self.assertEqual(r.status_code, 200, r.content)
        text = r.content.decode()
        self.assertEqual(len(r.json()["questions"]), 2)
        self.assertNotIn('"answer"', text)
        self.assertNotIn("Because 4.", text)  # the explanation
        self.assertNotIn('"correct"', text)

    # ---- scanning
    def test_scanning_marks_the_sheet_received_and_the_student_as_submitted(self):
        code = self.make(self.amina)[self.amina.pk]
        r = self.api.post("/api/paper/scan/", {"code": code.lower()[:4] + "-" + code.lower()[4:]}, format="json")  # a person typing it
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual((d["student"]["name"], d["sheet"]["already_scanned"]), ("amina", False))
        self.assertEqual(len(d["questions"]), 2)
        again = self.api.post("/api/paper/scan/", {"code": code}, format="json").json()
        self.assertTrue(again["sheet"]["already_scanned"])  # the same sheet scanned twice: the screen warns
        rows = self.api.get(f"/api/exams/not-submitted/?exam={self.exam.pk}&status=none,writing,auto,submitted").json()["rows"]
        row = next(x for x in rows if x["id"] == self.amina.pk)
        self.assertEqual((row["status"], row["paper"]), ("submitted", True))
        zrow = next(x for x in rows if x["id"] == self.zawadi.pk)
        self.assertEqual(zrow["status"], "none")

    def test_an_unknown_code(self):
        self.assertEqual(self.api.post("/api/paper/scan/", {"code": "NOPE2222"}, format="json").status_code, 404)
        self.assertEqual(self.api.post("/api/paper/scan/", {}, format="json").status_code, 404)

    # ---- keying in
    def test_answers_are_keyed_in_and_marked_like_any_exam(self):
        code = self.make(self.amina)[self.amina.pk]
        r = self.keyed(code, a="b", b="a")  # one right, one wrong
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["result"]["score"], r.json()["result"]["percent"]), (2.0, 50.0))
        sheet = PaperSheet.objects.get(code=code)
        self.assertEqual((sheet.attempt.status, sheet.attempt.student_id), (Attempt.SUBMITTED, self.amina.pk))
        self.assertTrue(sheet.received_at and sheet.entered_at)  # keying in also counts as received
        self.assertEqual(Result.objects.get(attempt=sheet.attempt).percent, 50.0)
        self.assertEqual(Answer.objects.filter(attempt=sheet.attempt).count(), 2)

    def test_keying_in_again_replaces_the_answers_and_re_marks(self):
        code = self.make(self.amina)[self.amina.pk]
        self.keyed(code, a="a", b="a")
        r = self.keyed(code, a="b", b="b")
        self.assertTrue(r.json()["redo"])
        self.assertEqual(r.json()["result"]["percent"], 100.0)
        self.assertEqual((Attempt.objects.filter(student=self.amina).count(), Answer.objects.count(), Result.objects.filter(student=self.amina).count()), (1, 2, 1))
        scanned = self.api.post("/api/paper/scan/", {"code": code}, format="json").json()
        self.assertEqual(scanned["answers"][str(self.q1.pk)], "b")  # the screen opens with what was keyed in
        self.assertEqual(scanned["result"]["percent"], 100.0)

    def test_an_empty_answer_counts_as_not_answered(self):
        code = self.make(self.amina)[self.amina.pk]
        r = self.api.post("/api/paper/answers/", {"code": code, "answers": {str(self.q1.pk): "b"}}, format="json")
        self.assertEqual(r.json()["result"]["percent"], 50.0)
        self.assertEqual((r.json()["answered"], r.json()["questions"]), (1, 2))
        self.assertEqual(Answer.objects.filter(skipped=True).count(), 1)

    def test_a_bad_answer_is_refused_and_nothing_is_saved(self):
        code = self.make(self.amina)[self.amina.pk]
        self.assertEqual(self.keyed(code, a="zzz").status_code, 400)  # not one of the choices
        bad = self.api.post("/api/paper/answers/", {"code": code, "answers": {"99999": "a"}}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertFalse(Attempt.objects.filter(student=self.amina).exists())

    def test_the_result_is_hidden_until_the_exam_has_ended(self):
        code = self.make(self.amina)[self.amina.pk]
        self.keyed(code)
        a = Attempt.objects.get(student=self.amina)
        from . import services
        self.assertFalse(services.result_visible(a))  # the exam is still live: released with everyone else's after it ends


class CleanTests(SimpleTestCase):
    """What the keyed-in answer must look like for each question type."""

    def eq(self, qtype, content):
        return SimpleNamespace(payload={"qtype": qtype, "content": content})

    def test_empty_is_none(self):
        e = self.eq("mcq_single", {"options": [{"id": "a"}]})
        self.assertIsNone(paper._clean(e, "", 1))
        self.assertIsNone(paper._clean(e, None, 1))

    def test_several_answers_keep_the_printed_order(self):
        e = self.eq("mcq_multi", {"options": [{"id": "a"}, {"id": "b"}, {"id": "c"}]})
        self.assertEqual(paper._clean(e, ["c", "a"], 1), ["a", "c"])
        with self.assertRaises(ExamError):
            paper._clean(e, ["a", "x"], 1)
        with self.assertRaises(ExamError):
            paper._clean(e, [["a"]], 1)

    def test_true_false_must_be_a_boolean(self):
        e = self.eq("true_false", {})
        self.assertIs(paper._clean(e, False, 1), False)
        with self.assertRaises(ExamError):
            paper._clean(e, "true", 1)

    def test_matching_and_ordering(self):
        m = self.eq("matching", {"left": [{"id": "l1"}, {"id": "l2"}], "right": [{"id": "r1"}, {"id": "r2"}]})
        self.assertEqual(paper._clean(m, {"l1": "r2", "l2": ""}, 1), {"l1": "r2"})
        with self.assertRaises(ExamError):
            paper._clean(m, {"l1": "nope"}, 1)
        with self.assertRaises(ExamError):
            paper._clean(m, {"l1": ["r1"]}, 1)
        o = self.eq("ordering", {"items": [{"id": "x"}, {"id": "y"}, {"id": "z"}]})
        self.assertEqual(paper._clean(o, ["z", "x", "y"], 1), ["z", "x", "y"])
        with self.assertRaises(ExamError):
            paper._clean(o, ["z", "x"], 1)  # half an order is not an answer
        with self.assertRaises(ExamError):
            paper._clean(o, ["x", "x", "y"], 1)

    def test_blanks(self):
        t = self.eq("fill_multi", {"blanks": [{"id": "1"}, {"id": "2"}]})
        self.assertEqual(paper._clean(t, {"1": " Dodoma ", "2": ""}, 1), {"1": "Dodoma"})
        b = self.eq("fill_multi", {"mode": "bank", "blanks": [{"id": "1"}], "bank": [{"id": "w1", "text": "x"}]})
        self.assertEqual(paper._clean(b, {"1": "w1"}, 1), {"1": "w1"})
        with self.assertRaises(ExamError):
            paper._clean(b, {"1": "free text"}, 1)
        self.assertEqual(paper._clean(self.eq("fill_blank", {}), "  42 ", 1), "42")

    def test_codes(self):
        self.assertEqual(paper.normalize_code(" k7m2-qx9r\n"), "K7M2QX9R")
        self.assertEqual(paper.pretty_code("K7M2QX9R"), "K7M2-QX9R")
