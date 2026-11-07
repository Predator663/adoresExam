"""An administrator ends one student's running attempt.  python manage.py test exams.test_end_attempt"""
from datetime import timedelta

from django.utils import timezone

from analytics.tests import AnalyticsBase
from core.models import AuditLog, SchoolSettings
from exams import services
from exams.models import Attempt, Exam, ExamQuestion
from exams.tests import mcq


class EndAttemptTests(AnalyticsBase):
    """The exam window closed an hour ago. Amina finished on time. Zawadi has extra time, so she is still writing."""

    def setUp(self):
        super().setUp()
        now = timezone.now()
        start = now - timedelta(hours=3)
        self.exam = Exam.objects.create(title="Maths", subject=self.maths, start_at=start, end_at=now - timedelta(hours=1),
                                        duration_minutes=30, status=Exam.SCHEDULED, shuffle_questions=False)
        self.exam.classes.add(self.cls_a, self.cls_b)
        for i in (1, 2):
            ExamQuestion.objects.create(exam=self.exam, position=i, payload=mcq())
        a = services.start_attempt(self.exam, self.amina, now=start + timedelta(minutes=1))
        for qid in a.order:
            services.submit_answer(a.pk, self.amina, qid, "b", now=start + timedelta(minutes=5))
        services.finalize_attempt(a.pk, start + timedelta(minutes=10))
        self.amina_attempt = Attempt.objects.get(pk=a.pk)
        z = services.start_attempt(self.exam, self.zawadi, now=start + timedelta(minutes=1))
        services.submit_answer(z.pk, self.zawadi, z.order[0], "b", now=start + timedelta(minutes=5))  # answered one of two
        Attempt.objects.filter(pk=z.pk).update(deadline_at=now + timedelta(minutes=40))  # her extra time runs past the exam's end
        self.z_id = z.pk
        self.ac = self.client_for(self.admin)
        self.url = f"/api/exams/{self.exam.pk}/end-attempt/"
        self.body = {"student_id": self.zawadi.pk, "mark": "submitted", "reason": "Extra time was given by mistake"}

    def exam_status(self):
        services.sync_exam(self.exam)
        self.exam.refresh_from_db()
        return self.exam.status

    def test_without_this_the_exam_cannot_publish(self):
        self.assertEqual(self.exam_status(), Exam.CLOSED)  # one attempt still running: nothing publishes
        self.assertEqual(self.ac.post(f"/api/exams/{self.exam.pk}/close/", {"confirm": True, "reason": "x"}, format="json").status_code, 400)  # Close needs a live exam

    def test_ending_her_attempt_publishes_the_exam_for_everybody(self):
        r = self.ac.post(self.url, self.body, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["exam_status"], r.json()["still_writing"]), (Exam.PUBLISHED, 0))
        a = Attempt.objects.get(pk=self.z_id)
        self.assertEqual((a.status, a.ended_by_id, a.end_reason), (Attempt.SUBMITTED, self.admin.pk, "Extra time was given by mistake"))
        self.assertIsNotNone(a.submitted_at)
        self.assertEqual(a.result.score, 2.0)  # the one answer she gave, marked (2 marks each)
        self.assertEqual(a.result.total, 4.0)
        # both students can open their results now
        for student, attempt_id in ((self.amina, self.amina_attempt.pk), (self.zawadi, self.z_id)):
            self.assertEqual(self.client_for(student).get(f"/api/results/{attempt_id}/").status_code, 200)

    def test_time_over_mark_and_the_students_message(self):
        self.body["mark"] = "time_over"
        self.assertEqual(self.ac.post(self.url, self.body, format="json").status_code, 200)
        a = Attempt.objects.get(pk=self.z_id)
        self.assertEqual(a.status, Attempt.AUTO_SUBMITTED)
        st = self.client_for(self.zawadi).get(f"/api/attempts/{self.z_id}/").json()
        self.assertTrue(st["finished"])
        self.assertIn("ended by your teacher", st["message"])  # not the plain "Well done" or "time is over" text

    def test_her_results_are_not_held_back_by_her_unused_extra_time(self):
        self.ac.post(self.url, self.body, format="json")
        a = Attempt.objects.select_related("exam").get(pk=self.z_id)
        delay = SchoolSettings.load().result_delay_minutes
        self.assertEqual(services.release_time(a), self.exam.end_at + timedelta(minutes=delay))
        self.assertTrue(services.result_visible(a))

    def test_audit_and_monitor_show_who_ended_it_and_why(self):
        self.ac.post(self.url, self.body, format="json")
        log = AuditLog.objects.get(action="exam.attempt.end")
        self.assertEqual((log.actor_id, log.target, log.detail["student"], log.detail["mark"]), (self.admin.pk, str(self.exam.pk), self.zawadi.pk, "submitted"))
        m = self.ac.get(f"/api/exams/{self.exam.pk}/monitor/").json()
        row = [s for s in m["submitted_students"] if s["id"] == self.zawadi.pk][0]
        self.assertTrue(row["ended_by_admin"])
        self.assertEqual(row["end_reason"], "Extra time was given by mistake")
        self.assertFalse([s for s in m["submitted_students"] if s["id"] == self.amina.pk][0]["ended_by_admin"])

    def test_only_admins(self):
        for who in (self.teacher, self.zawadi):
            self.assertEqual(self.client_for(who).post(self.url, self.body, format="json").status_code, 403)
        self.assertEqual(Attempt.objects.get(pk=self.z_id).status, Attempt.IN_PROGRESS)

    def test_refusals(self):
        bad = lambda **kw: self.ac.post(self.url, {**self.body, **kw}, format="json").status_code
        self.assertEqual(bad(reason=""), 400)
        self.assertEqual(bad(reason="   "), 400)
        self.assertEqual(bad(mark="cheated"), 400)
        self.assertEqual(bad(student_id="abc"), 400)
        self.assertEqual(bad(student_id=self.amina.pk), 400)  # she already finished: nothing running to end
        self.assertEqual(bad(student_id=999999), 400)
        self.assertEqual(Attempt.objects.get(pk=self.z_id).status, Attempt.IN_PROGRESS)  # nothing changed
        self.assertEqual(bad(), 200)
        self.assertEqual(bad(), 400)  # a second tap finds nothing running

    def test_works_while_the_exam_is_still_live_too(self):
        now = timezone.now()
        Exam.objects.filter(pk=self.exam.pk).update(end_at=now + timedelta(hours=1), status=Exam.LIVE)
        Attempt.objects.filter(pk=self.z_id).update(deadline_at=now + timedelta(minutes=20))
        r = self.ac.post(self.url, self.body, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["exam_status"], Exam.LIVE)  # others may still be writing: the exam stays live
        self.assertEqual(Attempt.objects.get(pk=self.z_id).status, Attempt.SUBMITTED)
