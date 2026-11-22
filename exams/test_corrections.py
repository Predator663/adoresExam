"""A wrong answer key found after the exam: correct it, re-mark everything, tell the students.
Run:  python manage.py test exams.test_corrections"""
from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone

from academics.models import TeacherAssignment
from accounts.models import User
from django.contrib.auth.hashers import make_password
from gamification import rules, services as gam
from gamification.models import XPEvent
from notifications.models import Notification
from questions.models import Question
from core.models import SchoolSettings
from . import corrections, services
from .models import Answer, Attempt, Exam, ExamCorrection, ExamQuestion, Result, ResultChange, SavedQuestion
from .tests import Base, mcq


class CorrectionTests(Base):
    """Q1's key says "a" but "b" is right (the typo). Amina answered b (right, marked wrong), Zawadi answered a (wrong, marked right)."""

    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.exam.start_at, self.exam.end_at, self.exam.status = now - timedelta(hours=6), now - timedelta(hours=5), Exam.CLOSED
        self.exam.save()
        ExamQuestion.objects.filter(exam=self.exam).delete()
        self.src = Question.objects.create(subject=self.subject, qtype="mcq_single", prompt="2+2?", marks=2, answer={"correct": "a"}, status=Question.APPROVED,
                                           content={"options": [{"id": "a", "text": "3"}, {"id": "b", "text": "4"}, {"id": "c", "text": "5"}]})
        self.q1 = ExamQuestion.objects.create(exam=self.exam, position=1, payload=mcq(correct="a"), source=self.src)
        self.q2 = ExamQuestion.objects.create(exam=self.exam, position=2, payload=mcq(correct="b"))
        self.att = {}
        for who, first in ((self.amina, "b"), (self.zawadi, "a")):
            a = Attempt.objects.create(exam=self.exam, student=who, status=Attempt.SUBMITTED, started_at=self.exam.start_at, deadline_at=self.exam.start_at + timedelta(minutes=40),
                                       submitted_at=self.exam.start_at + timedelta(minutes=30))
            Answer.objects.create(attempt=a, exam_question=self.q1, response=first)
            Answer.objects.create(attempt=a, exam_question=self.q2, response="b")
            services.compute_result(a)
            self.att[who.username] = a
        services.sync_exam(self.exam)
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, Exam.PUBLISHED)  # results are out: students have seen 50% and 100%

    def res(self, who):
        return Result.objects.get(attempt=self.att[who])

    def fix(self, **extra):
        body = {"exam_question_id": self.q1.pk, "answer": {"correct": "b"}, "reason": "Option B is the right answer, the key had a typo", **extra}
        with self.captureOnCommitCallbacks(execute=True):  # the notifications are sent after the commit; a TestCase never commits by itself
            return self.client_for(self.admin).post(f"/api/exams/{self.exam.pk}/correct-question/", body, format="json")

    def test_before_state(self):
        self.assertEqual((self.res("amina").percent, self.res("zawadi").percent), (50.0, 100.0))

    def test_preview_shows_the_effect_and_changes_nothing(self):
        r = self.fix(preview=True)
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertTrue(d["preview"])
        self.assertEqual((d["students"], d["changed"], d["up"], d["down"]), (2, 2, 1, 1))
        rows = {x["student_id"]: x for x in d["rows"]}
        self.assertEqual((rows[self.amina.pk]["before"]["percent"], rows[self.amina.pk]["after"]["percent"]), (50.0, 100.0))
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.payload["answer"], {"correct": "a"})
        self.assertEqual((self.res("amina").percent, self.res("amina").revision), (50.0, 0))
        self.assertEqual(ExamCorrection.objects.count(), 0)
        self.assertEqual(Notification.objects.filter(kind="result_updated").count(), 0)

    def test_apply_remarks_every_result_and_remembers_the_old_ones(self):
        r = self.fix()
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual((d["changed"], d["up"], d["down"], d["visible_now"]), (2, 1, 1, True))
        a, z = self.res("amina"), self.res("zawadi")
        self.assertEqual((a.score, a.percent, a.grade, a.revision), (4.0, 100.0, "A", 1))
        self.assertEqual((z.score, z.percent, z.revision), (2.0, 50.0, 1))
        self.assertEqual(a.previous["percent"], 50.0)
        self.assertIsNotNone(a.corrected_at)
        self.assertEqual(Answer.objects.get(attempt=self.att["amina"], exam_question=self.q1).marks_awarded, 2)  # each answer re-marked too
        self.assertEqual(Answer.objects.get(attempt=self.att["zawadi"], exam_question=self.q1).marks_awarded, 0)
        corr = ExamCorrection.objects.get()
        self.assertEqual((corr.number, corr.changed, corr.students, corr.by), (1, 2, 2, self.admin))
        self.assertEqual(corr.before["answer"], {"correct": "a"})
        self.assertEqual(corr.after["answer"], {"correct": "b"})
        self.assertEqual(ResultChange.objects.filter(correction=corr).count(), 2)

    def test_students_are_told_and_see_the_updated_result(self):
        self.fix()
        n = Notification.objects.get(user=self.amina, kind="result_updated")
        self.assertIn("100", n.body)
        self.assertIn("50", n.body)
        self.assertEqual(n.data["attempt_id"], self.att["amina"].pk)
        self.assertTrue(Notification.objects.filter(user=self.zawadi, kind="result_updated").exists())
        r = self.client_for(self.amina).get(f"/api/results/{self.att['amina'].pk}/").json()
        self.assertEqual(r["percent"], 100.0)
        self.assertEqual(r["updated"]["previous"]["percent"], 50.0)
        self.assertIn("typo", r["updated"]["reason"])
        lst = self.client_for(self.amina).get("/api/results/").json()
        row = lst["results"][0] if isinstance(lst, dict) else lst[0]
        self.assertTrue(row["updated"])
        self.assertEqual(row["previous_percent"], 50.0)

    def test_notify_can_be_switched_off(self):
        self.fix(notify=False)
        self.assertEqual(Notification.objects.filter(kind="result_updated").count(), 0)
        self.assertEqual(self.res("amina").percent, 100.0)  # still re-marked

    def test_subject_teachers_are_told_too(self):
        t = User.objects.create(username="mwalimu", role="teacher", password=make_password("Tch3r-pass!"))
        TeacherAssignment.objects.create(teacher=t, subject=self.subject)
        self.fix()
        self.assertTrue(Notification.objects.filter(user=t, kind="result_updated").exists())

    def test_a_second_correction_stacks(self):
        self.fix()
        r = self.client_for(self.admin).post(f"/api/exams/{self.exam.pk}/correct-question/", {"exam_question_id": self.q1.pk, "answer": {"correct": "c"}, "reason": "Actually C"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        a = self.res("amina")
        self.assertEqual((a.revision, a.percent, a.previous["percent"]), (2, 50.0, 100.0))
        self.assertEqual(ExamCorrection.objects.count(), 2)

    def test_marks_can_be_corrected_too(self):
        r = self.client_for(self.admin).post(f"/api/exams/{self.exam.pk}/correct-question/", {"exam_question_id": self.q2.pk, "answer": {"correct": "b"}, "marks": 6, "reason": "Q2 is worth 6"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.res("amina").total, 8.0)
        self.assertEqual(self.res("amina").score, 6.0)  # only Q2 right: 6 of 8

    # ---- what is refused
    def test_refusals(self):
        c = self.client_for(self.admin)
        url = f"/api/exams/{self.exam.pk}/correct-question/"
        self.assertEqual(c.post(url, {"exam_question_id": self.q1.pk, "answer": {"correct": "b"}}, format="json").status_code, 400)  # no reason
        self.assertEqual(c.post(url, {"exam_question_id": self.q1.pk, "answer": {"correct": "a"}, "reason": "x"}, format="json").status_code, 400)  # nothing changes
        self.assertEqual(c.post(url, {"exam_question_id": self.q1.pk, "answer": {"correct": "z"}, "reason": "x"}, format="json").status_code, 400)  # not a choice
        bad = {"options": [{"id": "a", "text": "3"}, {"id": "b", "text": "4"}]}
        self.assertEqual(c.post(url, {"exam_question_id": self.q1.pk, "content": bad, "answer": {"correct": "b"}, "reason": "x"}, format="json").status_code, 400)  # a choice removed
        self.assertEqual(c.post(url, {"exam_question_id": 999999, "answer": {"correct": "b"}, "reason": "x"}, format="json").status_code, 404)
        self.assertEqual(ExamCorrection.objects.count(), 0)

    def test_only_administrators_correct(self):
        t = User.objects.create(username="mwalimu", role="teacher", password=make_password("Tch3r-pass!"))
        TeacherAssignment.objects.create(teacher=t, subject=self.subject)
        for who in (t, self.amina):
            self.assertEqual(self.client_for(who).post(f"/api/exams/{self.exam.pk}/correct-question/", {"exam_question_id": self.q1.pk, "answer": {"correct": "b"}, "reason": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client_for(t).get(f"/api/exams/{self.exam.pk}/corrections/").status_code, 200)  # a teacher may read the history

    def test_not_while_the_exam_is_running(self):
        now = timezone.now()
        Exam.objects.filter(pk=self.exam.pk).update(status=Exam.LIVE, start_at=now - timedelta(minutes=5), end_at=now + timedelta(hours=1))
        r = self.fix()
        self.assertEqual(r.status_code, 409)

    def test_a_voided_question_cannot_be_corrected(self):
        ExamQuestion.objects.filter(pk=self.q1.pk).update(voided=True)
        self.assertEqual(self.fix().status_code, 409)

    # ---- the question bank and other exams
    def test_the_bank_question_is_fixed_and_other_exams_are_listed(self):
        other = Exam.objects.create(title="Mock", subject=self.subject, start_at=timezone.now() + timedelta(days=3), end_at=timezone.now() + timedelta(days=3, hours=1),
                                    duration_minutes=30, status=Exam.SCHEDULED)
        eq_future = ExamQuestion.objects.create(exam=other, position=1, payload=mcq(correct="a"), source=self.src)
        done = Exam.objects.create(title="Old test", subject=self.subject, start_at=timezone.now() - timedelta(days=9), end_at=timezone.now() - timedelta(days=9, hours=-1),
                                   duration_minutes=30, status=Exam.PUBLISHED)
        ExamQuestion.objects.create(exam=done, position=1, payload=mcq(correct="a"), source=self.src)
        d = self.fix().json()
        self.src.refresh_from_db()
        self.assertEqual(self.src.answer, {"correct": "b"})
        self.assertEqual(self.src.version, 2)
        self.assertTrue(d["bank_updated"])
        eq_future.refresh_from_db()
        self.assertEqual(eq_future.payload["answer"], {"correct": "b"})  # an exam not started yet takes the fix
        self.assertEqual(d["future_exams_updated"], 1)
        self.assertEqual([x["exam"] for x in d["also_in"]], ["Old test"])  # a finished exam must be corrected on purpose

    def test_the_bank_is_left_alone_when_it_was_already_fixed_or_the_admin_says_no(self):
        self.src.answer = {"correct": "c"}
        self.src.save()
        self.assertFalse(self.fix().json()["bank_updated"])
        self.src.refresh_from_db()
        self.assertEqual(self.src.answer, {"correct": "c"})

    # ---- rewards stay honest
    def test_xp_follows_the_corrected_mark(self):
        cfg = gam.config()
        for who in ("amina", "zawadi"):
            self.assertTrue(gam.reward_attempt(self.att[who]))
        self.assertTrue(XPEvent.objects.filter(user=self.zawadi, key=f"perfect:{self.exam.pk}").exists())
        self.assertEqual(XPEvent.objects.get(user=self.amina, key=f"score:{self.exam.pk}").points, rules.score_xp(50, cfg["xp"]["score_per_percent"], cfg["xp"]["score_max"]))
        self.fix()
        self.assertEqual(XPEvent.objects.get(user=self.amina, key=f"score:{self.exam.pk}").points, rules.score_xp(100, cfg["xp"]["score_per_percent"], cfg["xp"]["score_max"]))
        self.assertTrue(XPEvent.objects.filter(user=self.amina, key=f"perfect:{self.exam.pk}").exists())  # she earned the perfect-score bonus
        self.assertFalse(XPEvent.objects.filter(user=self.zawadi, key=f"perfect:{self.exam.pk}").exists())  # and Zawadi no longer has one she did not earn
        self.assertEqual(XPEvent.objects.get(user=self.zawadi, key=f"score:{self.exam.pk}").points, rules.score_xp(50, cfg["xp"]["score_per_percent"], cfg["xp"]["score_max"]))

    def test_history(self):
        self.fix()
        h = self.client_for(self.admin).get(f"/api/exams/{self.exam.pk}/corrections/").json()
        self.assertEqual(len(h), 1)
        self.assertEqual((h[0]["number"], h[0]["changed"], h[0]["by"]), (1, 2, "admin1"))
        self.assertEqual(len(h[0]["changes"]), 2)

    def test_the_correction_screen_gets_the_key_and_how_the_class_answered(self):
        d = self.client_for(self.admin).get(f"/api/exams/{self.exam.pk}/question-key/?eq={self.q1.pk}").json()
        self.assertEqual(d["answer"], {"correct": "a"})
        self.assertEqual(d["stats"]["answered"], 2)
        self.assertEqual(d["stats"]["choices"], {"a": 1, "b": 1})


    def test_bookmarked_copies_get_the_corrected_answer(self):
        sv = SavedQuestion.objects.create(student=self.amina, attempt=self.att["amina"], number=1,
                                          snapshot={"answer": {"correct": "a"}, "content": self.q1.payload["content"], "marks": 2, "explanation": "old", "marks_awarded": 0})
        self.fix()
        sv.refresh_from_db()
        self.assertEqual((sv.snapshot["answer"], sv.snapshot["marks_awarded"]), ({"correct": "b"}, 2))

    # ---- a correction BEFORE results are released: nobody may be shown a mark she never saw
    def test_a_correction_before_release_shows_no_updated_banner(self):
        st = SchoolSettings.load()
        st.result_delay_minutes = 30
        st.save()
        now = timezone.now()
        Exam.objects.filter(pk=self.exam.pk).update(status=Exam.CLOSED, start_at=now - timedelta(hours=2), end_at=now - timedelta(minutes=1))
        r = self.fix()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()["visible_now"])
        a = self.res("amina")
        self.assertEqual((a.percent, a.revision, a.previous), (100.0, 0, None))  # re-marked, but she never saw 50%
        self.assertEqual(Notification.objects.filter(kind="result_updated").count(), 0)
        self.assertEqual(ExamCorrection.objects.get().changed, 2)  # the admin's history still records it


class BuildPayloadTests(SimpleTestCase):
    def test_a_missing_explanation_equals_an_empty_one(self):
        base = {"answer": {"correct": "a"}, "content": {}, "marks": 1}
        self.assertEqual(corrections._norm(base), corrections._norm({**base, "explanation": ""}))

    def test_the_word_bank_keeps_its_ids_and_words(self):
        bank = [{"id": "w1", "text": "x"}, {"id": "w2", "text": "y"}, {"id": "w3", "text": "z"}]
        p = {"qtype": "fill_multi", "prompt": "A [[1]] B [[2]]", "marks": 2,
             "content": {"blanks": [{"id": "1"}, {"id": "2"}], "mode": "bank", "bank": bank, "hint": "", "width": "medium"},
             "answer": {"blanks": {"1": {"accepted": ["x"]}, "2": {"accepted": ["y"]}}, "distractors": ["z"], "case_sensitive": False, "ignore_punct": False, "partial": None}}
        new = corrections.build_payload(p, {"answer": {**p["answer"], "blanks": {"1": {"accepted": ["q", "x"]}, "2": {"accepted": ["y"]}}}})
        self.assertEqual(new["content"]["bank"], bank)  # students' answers are word ids: they must still mean the same words
        self.assertEqual(new["answer"]["blanks"]["1"]["accepted"], ["q", "x"])

    def test_choosing_another_bank_word_as_the_right_one(self):
        bank = [{"id": "w1", "text": "x"}, {"id": "w2", "text": "y"}, {"id": "w3", "text": "z"}]
        p = {"qtype": "fill_multi", "prompt": "A [[1]] B [[2]]", "marks": 2,
             "content": {"blanks": [{"id": "1"}, {"id": "2"}], "mode": "bank", "bank": bank, "hint": "", "width": "medium"},
             "answer": {"blanks": {"1": {"accepted": ["x"]}, "2": {"accepted": ["y"]}}, "distractors": ["z"], "case_sensitive": False, "ignore_punct": False, "partial": None}}
        new = corrections.build_payload(p, {"answer": {**p["answer"], "blanks": {"1": {"accepted": ["z"]}, "2": {"accepted": ["y"]}}, "distractors": ["x"]}})
        self.assertEqual(new["answer"]["blanks"]["1"]["accepted"], ["z"])
        self.assertEqual(new["content"]["bank"], bank)

    def test_several_answers_and_ordering(self):
        opts = [{"id": i, "text": i} for i in "abc"]
        m = {"qtype": "mcq_multi", "prompt": "p", "marks": 2, "content": {"options": opts}, "answer": {"correct": ["a"]}}
        self.assertEqual(corrections.build_payload(m, {"answer": {"correct": ["b", "a"]}})["answer"], {"correct": ["a", "b"]})
        o = {"qtype": "ordering", "prompt": "p", "marks": 2, "content": {"items": opts}, "answer": {"order": ["a", "b", "c"]}}
        new = corrections.build_payload(o, {"content": {"items": [opts[2], opts[0], opts[1]]}})
        self.assertEqual(new["answer"], {"order": ["c", "a", "b"]})
