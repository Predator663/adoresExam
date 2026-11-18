"""Every question has its own time limit.  python manage.py test exams.test_question_timeout"""
from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone

from analytics.tests import AnalyticsBase
from exams import services, timing
from exams.models import Answer, Attempt, Exam, ExamQuestion
from exams.tests import mcq


class TimingRulesTests(SimpleTestCase):
    def test_every_type_has_a_default(self):
        for t in ("mcq_single", "mcq_multi", "true_false", "matching", "fill_blank", "fill_multi", "ordering"):
            self.assertTrue(timing.MIN_SECONDS <= timing.default_limit(t) <= timing.MAX_SECONDS)

    def test_more_blanks_more_time(self):
        self.assertGreater(timing.default_limit("fill_multi", {"blanks": [1] * 6}), timing.default_limit("fill_multi", {"blanks": [1] * 2}))

    def test_clean_limit(self):
        self.assertIsNone(timing.clean_limit(""))
        self.assertEqual(timing.clean_limit("90"), 90)
        for bad in (5, 4000, "abc"):
            with self.assertRaises(ValueError):
                timing.clean_limit(bad)

    def test_old_question_without_a_limit_gets_the_default(self):
        self.assertEqual(timing.limit_for({"qtype": "true_false"}), timing.default_limit("true_false"))
        self.assertEqual(timing.limit_for({"qtype": "true_false", "time_limit_seconds": 20}), 20)


class QuestionClockTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        self.exam = Exam.objects.create(title="Maths", subject=self.maths, start_at=now - timedelta(minutes=5), end_at=now + timedelta(hours=2),
                                        duration_minutes=90, status=Exam.LIVE, shuffle_questions=False)
        self.exam.classes.add(self.cls_a)
        for i in (1, 2, 3):
            p = mcq()
            p["time_limit_seconds"] = 30
            ExamQuestion.objects.create(exam=self.exam, position=i, payload=p)
        self.t0 = now
        self.a = services.start_attempt(self.exam, self.amina, now=now)

    def state(self, at):
        return services.attempt_state(Attempt.objects.select_related("exam").get(pk=self.a.pk), at)

    def test_the_clock_starts_when_she_first_sees_the_question(self):
        s = self.state(self.t0)
        self.assertEqual(s["question_limit_seconds"], 30)
        self.assertEqual(s["question_deadline_at"], Attempt.objects.get(pk=self.a.pk).question_started_at + timedelta(seconds=30))
        later = self.state(self.t0 + timedelta(seconds=10))  # looking again does not restart it
        self.assertEqual(later["question_deadline_at"], s["question_deadline_at"])

    def test_answer_in_time_is_kept_and_the_next_clock_waits(self):
        self.state(self.t0)
        services.submit_answer(self.a.pk, self.amina, self.a.order[0], "b", now=self.t0 + timedelta(seconds=20))
        a = Attempt.objects.get(pk=self.a.pk)
        self.assertIsNone(a.question_started_at)
        self.assertFalse(Answer.objects.get(attempt=a, exam_question_id=self.a.order[0]).timed_out)

    def test_answer_sent_far_too_late_is_timed_out_and_not_used(self):
        self.state(self.t0)
        services.submit_answer(self.a.pk, self.amina, self.a.order[0], "b", now=self.t0 + timedelta(seconds=90))
        ans = Answer.objects.get(attempt_id=self.a.pk, exam_question_id=self.a.order[0])
        self.assertTrue(ans.skipped and ans.timed_out)
        self.assertIsNone(ans.response)

    def test_answer_sent_at_zero_within_the_grace_is_kept(self):
        self.state(self.t0)
        services.submit_answer(self.a.pk, self.amina, self.a.order[0], "b", now=self.t0 + timedelta(seconds=33))
        self.assertFalse(Answer.objects.get(attempt_id=self.a.pk, exam_question_id=self.a.order[0]).timed_out)

    def test_an_answer_that_waited_offline_counts_by_when_she_gave_it(self):
        self.state(self.t0)
        at = int((self.t0 + timedelta(seconds=20)).timestamp() * 1000)
        services.submit_answer(self.a.pk, self.amina, self.a.order[0], "b", now=self.t0 + timedelta(minutes=5), at=at)
        self.assertFalse(Answer.objects.get(attempt_id=self.a.pk, exam_question_id=self.a.order[0]).timed_out)

    def test_time_runs_out_with_nothing_chosen_even_when_skipping_is_off(self):
        self.state(self.t0)
        self.assertFalse(self.exam.allow_skip)
        services.submit_answer(self.a.pk, self.amina, self.a.order[0], None, skip=True, timeout=True, now=self.t0 + timedelta(seconds=30))
        ans = Answer.objects.get(attempt_id=self.a.pk, exam_question_id=self.a.order[0])
        self.assertTrue(ans.skipped and ans.timed_out)
        self.assertEqual(Attempt.objects.get(pk=self.a.pk).current_index, 1)

    def test_skip_without_a_timeout_is_still_refused_when_skipping_is_off(self):
        self.state(self.t0)
        with self.assertRaises(services.ExamError):
            services.submit_answer(self.a.pk, self.amina, self.a.order[0], None, skip=True, now=self.t0 + timedelta(seconds=5))

    def test_closing_the_app_does_not_buy_time(self):
        self.state(self.t0)
        s = self.state(self.t0 + timedelta(seconds=75))  # 30 s + 30 s ran out while she was away; the 3rd question is running
        a = Attempt.objects.get(pk=self.a.pk)
        self.assertEqual(a.current_index, 2)
        self.assertEqual(Answer.objects.filter(attempt=a, timed_out=True).count(), 2)
        self.assertEqual(s["index"], 3)
        self.assertEqual(a.question_started_at, self.t0 + timedelta(seconds=60))  # runs on from where the last one ended

    def test_all_questions_timed_out_submits_the_exam(self):
        self.state(self.t0)
        s = self.state(self.t0 + timedelta(minutes=5))
        self.assertTrue(s["finished"])
        self.assertEqual(Answer.objects.filter(attempt_id=self.a.pk, timed_out=True).count(), 3)

    def test_the_clock_waits_while_the_screen_is_locked(self):
        self.state(self.t0)
        from unittest import mock
        with mock.patch("proctoring.services.lock_reason", return_value="manual"):
            s = self.state(self.t0 + timedelta(seconds=20))
        self.assertIsNone(s["question"])
        self.assertIsNone(Attempt.objects.get(pk=self.a.pk).question_started_at)  # it starts again when she can see the question
