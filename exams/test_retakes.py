"""Retake permission for students who missed an exam (one, several or many at once). Run:  python manage.py test exams.test_retakes"""
from datetime import timedelta
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.utils import timezone

from academics.models import SchoolClass
from accounts.models import User
from core.models import AuditLog
from notifications.models import Notification
from . import services
from .models import Attempt, Exam, ExamGrant, ExamQuestion
from .services import ExamError
from .tests import Base, mcq


class RetakeForMissedTests(Base):
    def setUp(self):
        super().setUp()
        now = timezone.now()
        # the exam was held yesterday: it is over, and the late-entry time is long gone
        self.exam.start_at, self.exam.end_at = now - timedelta(hours=26), now - timedelta(hours=25)
        self.exam.status = Exam.PUBLISHED
        self.exam.save()
        self.teacher = User.objects.create(username="teach", role="teacher", password=make_password("Teach-pass-1"))
        self.third = User.objects.create(username="third", role="student", school_class=self.cls, password=make_password("pw-third-1"), index_number="S3")
        self.api = self.client_for(self.admin)

    def grant(self, ids, reason="was ill", exam=None):
        return self.api.post(f"/api/exams/{(exam or self.exam).pk}/grant-retakes/", {"student_ids": ids, "reason": reason}, format="json")

    def pending(self, student):
        return ExamGrant.objects.filter(exam=self.exam, student=student, kind="retake", used=False).count()

    # ---- the core rule
    def test_missed_student_is_blocked_until_allowed_then_gets_full_time(self):
        with self.assertRaises(ExamError) as e:
            services.start_attempt(self.exam, self.amina)
        self.assertEqual(e.exception.code, "too_late")
        r = self.grant([self.amina.pk]).json()
        self.assertEqual((r["granted"], r["breakdown"]["never_started"]), (1, 1))
        now = timezone.now()
        attempt = services.start_attempt(self.exam, self.amina)
        self.assertEqual(attempt.attempt_no, 1)
        # full 40 minutes from NOW, not cut off at the exam's end time (which was a day ago)
        self.assertAlmostEqual((attempt.deadline_at - now).total_seconds(), 40 * 60, delta=5)
        self.assertEqual(self.pending(self.amina), 0)  # the permission is used
        services.finalize_attempt(attempt.pk)
        with self.assertRaises(ExamError) as e:  # one sitting only
            services.start_attempt(self.exam, self.amina)
        self.assertEqual(e.exception.code, "already_taken")

    def test_permission_never_lets_anyone_in_before_the_exam_starts(self):
        self.exam.start_at = timezone.now() + timedelta(hours=2)
        self.exam.end_at = self.exam.start_at + timedelta(hours=1)
        self.exam.status = Exam.SCHEDULED
        self.exam.save()
        self.grant([self.amina.pk])
        with self.assertRaises(ExamError) as e:
            services.start_attempt(self.exam, self.amina)
        self.assertEqual(e.exception.code, "too_early")
        self.assertEqual(self.pending(self.amina), 1)  # not used up by the refusal

    def test_student_screen_shows_start_after_permission(self):
        s = self.client_for(self.amina)
        mine = lambda: [c for c in s.get("/api/student/exams/").json() if c["id"] == self.exam.pk]
        self.assertEqual(mine(), [])  # a day-old exam is not on her list
        self.grant([self.amina.pk])
        (c,) = mine()
        self.assertEqual((c["state"], c["retake"]), ("open", True))  # it comes back, as something she can start
        with mock.patch("exams.views.proctoring.enabled", return_value=False):  # no GPS in a test; the start rule itself is what matters
            r = s.post(f"/api/student/exams/{self.exam.pk}/start/", {"agree_rules": True}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Attempt.objects.get(student=self.amina).attempt_no, 1)
        (c,) = mine()
        self.assertEqual(c["state"], "in_progress")

    def test_other_students_stay_blocked(self):
        self.grant([self.amina.pk])
        with self.assertRaises(ExamError) as e:
            services.start_attempt(self.exam, self.zawadi)
        self.assertEqual(e.exception.code, "too_late")

    def test_older_retake_for_a_missed_student_now_works(self):
        ExamGrant.objects.create(exam=self.exam, student=self.amina, kind="retake", reason="old grant", granted_by=self.admin)
        self.assertEqual(services.start_attempt(self.exam, self.amina).attempt_no, 1)

    # ---- the three kinds of "not submitted"
    def test_batch_covers_never_started_writing_and_timed_out(self):
        self.exam.start_at, self.exam.end_at = timezone.now() - timedelta(minutes=1), timezone.now() + timedelta(hours=1)
        self.exam.status = Exam.LIVE
        self.exam.save()
        writing = services.start_attempt(self.exam, self.zawadi)  # still writing now
        timed = services.start_attempt(self.exam, self.third)
        services.finalize_attempt(timed.pk, auto=True)  # time ran out
        r = self.grant([self.amina.pk, self.zawadi.pk, self.third.pk]).json()
        self.assertEqual((r["granted"], r["breakdown"]), (3, {"never_started": 1, "still_writing": 1, "finished": 1}))
        # the one still writing resumes the SAME attempt; the permission waits until she finishes
        self.assertEqual(services.start_attempt(self.exam, self.zawadi).pk, writing.pk)
        self.assertEqual(self.pending(self.zawadi), 1)
        services.finalize_attempt(writing.pk)
        self.assertEqual(services.start_attempt(self.exam, self.zawadi).attempt_no, 2)
        self.assertEqual(services.start_attempt(self.exam, self.third).attempt_no, 2)

    # ---- the endpoint
    def test_only_administrators(self):
        for who in (self.amina, self.teacher):
            c = self.client_for(who)
            body = {"student_ids": [self.amina.pk], "reason": "x"}
            self.assertEqual(c.post(f"/api/exams/{self.exam.pk}/grant-retakes/", body, format="json").status_code, 403)
            self.assertEqual(c.post(f"/api/exams/{self.exam.pk}/revoke-retakes/", body, format="json").status_code, 403)
        self.assertEqual(self.pending(self.amina), 0)

    def test_validation(self):
        post = lambda body: self.api.post(f"/api/exams/{self.exam.pk}/grant-retakes/", body, format="json").status_code
        self.assertEqual(post({"student_ids": [self.amina.pk]}), 400)  # a reason is required
        self.assertEqual(post({"student_ids": [self.amina.pk], "reason": "   "}), 400)
        self.assertEqual(post({"student_ids": [], "reason": "x"}), 400)
        self.assertEqual(post({"student_ids": "1", "reason": "x"}), 400)
        self.assertEqual(post({"student_ids": ["a"], "reason": "x"}), 400)
        self.assertEqual(post({"student_ids": list(range(1, 502)), "reason": "x"}), 400)
        self.assertEqual(ExamGrant.objects.count(), 0)

    def test_draft_exam_is_refused(self):
        draft = Exam.objects.create(title="Draft", subject=self.subject, status=Exam.DRAFT, duration_minutes=30)
        draft.classes.add(self.cls)
        self.assertEqual(self.grant([self.amina.pk], exam=draft).status_code, 400)

    def test_pressing_twice_never_gives_two_permissions(self):
        self.assertEqual(self.grant([self.amina.pk, self.zawadi.pk]).json()["granted"], 2)
        again = self.grant([self.amina.pk, self.zawadi.pk, self.third.pk]).json()
        self.assertEqual((again["granted"], again["already_allowed"]), (1, 2))
        self.assertEqual(ExamGrant.objects.filter(exam=self.exam, kind="retake").count(), 3)

    def test_students_outside_the_exam_are_not_eligible(self):
        other = SchoolClass.objects.create(name="Form 2", form_level=2)
        out = User.objects.create(username="outsider", role="student", school_class=other, password=make_password("pw-out-1"))
        r = self.grant([self.amina.pk, out.pk, self.admin.pk, 999999]).json()
        self.assertEqual((r["granted"], r["not_eligible"], r["requested"]), (1, 3, 4))
        self.assertEqual(ExamGrant.objects.filter(student=out).count(), 0)

    def test_audit_and_notification(self):
        self.grant([self.amina.pk, self.zawadi.pk], reason="Network was down at school")
        log = AuditLog.objects.get(action="exam.grant.retake.bulk")
        self.assertEqual((log.actor_id, log.target, log.detail["count"], log.detail["reason"]), (self.admin.pk, str(self.exam.pk), 2, "Network was down at school"))
        self.assertEqual(sorted(log.detail["usernames"]), ["amina", "zawadi"])
        n = Notification.objects.get(user=self.amina, kind="retake_allowed")
        self.assertIn("Maths Test", n.title)
        self.assertEqual(n.data["exam_id"], self.exam.pk)
        self.assertFalse(Notification.objects.filter(user=self.third).exists())

    def test_a_failing_notification_does_not_undo_the_permission(self):
        with mock.patch("notifications.services.notify_i18n", side_effect=RuntimeError("push down")):
            with self.assertLogs("exams.views", level="ERROR"):
                r = self.grant([self.amina.pk])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.pending(self.amina), 1)

    def test_revoke_only_takes_back_unused_permissions(self):
        self.grant([self.amina.pk, self.zawadi.pk])
        services.start_attempt(self.exam, self.zawadi)  # used
        r = self.api.post(f"/api/exams/{self.exam.pk}/revoke-retakes/", {"student_ids": [self.amina.pk, self.zawadi.pk]}, format="json").json()
        self.assertEqual(r["revoked"], 1)
        self.assertEqual(self.pending(self.amina), 0)
        with self.assertRaises(ExamError):
            services.start_attempt(self.exam, self.amina)
        self.assertTrue(Attempt.objects.filter(student=self.zawadi).exists())  # her attempt is untouched
        self.assertTrue(AuditLog.objects.filter(action="exam.grant.retake.revoke").exists())

    # ---- the Not-submitted report
    def test_report_marks_who_is_allowed(self):
        self.grant([self.amina.pk])
        d = self.api.get(f"/api/exams/not-submitted/?exam={self.exam.pk}&status=none").json()
        by = {r["name"]: r for r in d["rows"]}
        self.assertTrue(by["amina"]["retake_allowed"] if "amina" in by else any(r["retake_allowed"] for r in d["rows"]))
        self.assertEqual(sum(1 for r in d["rows"] if r["retake_allowed"]), 1)
        self.assertEqual(d["summary"]["allowed"], 1)
        services.start_attempt(self.exam, self.amina)  # she sits: the permission is used
        d = self.api.get(f"/api/exams/not-submitted/?exam={self.exam.pk}&status=none,writing").json()
        self.assertEqual(d["summary"]["allowed"], 0)
        self.assertFalse(any(r["retake_allowed"] for r in d["rows"]))
