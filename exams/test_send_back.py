"""An administrator sends a submitted paper back to the teacher with a reason; the teacher gets a pop-up.
Run:  python manage.py test exams.test_send_back"""
from django.contrib.auth.hashers import make_password

from academics.models import TeacherAssignment
from accounts.models import User
from notifications.models import Notification
from .models import Exam
from .tests import Base


class SendBackTests(Base):
    def setUp(self):
        super().setUp()
        self.teacher = User.objects.create(username="mwalimu", role="teacher", password=make_password("Tch3r-pass!"))
        self.other = User.objects.create(username="mwalimu2", role="teacher", password=make_password("Tch3r-pass!"))
        TeacherAssignment.objects.create(teacher=self.teacher, subject=self.subject)
        TeacherAssignment.objects.create(teacher=self.other, subject=self.subject)
        self.draft = Exam.objects.create(subject=self.subject, title="Paper A", created_by=self.teacher, duration_minutes=30)
        self.draft.questions.create(position=1, payload=self.exam.questions.first().payload)
        self.t = self.client_for(self.teacher)
        self.a = self.client_for(self.admin)
        self.assertEqual(self.t.post(f"/api/exams/{self.draft.pk}/submit/", {}, format="json").status_code, 200)

    def send_back(self, reason="Question 3 has two correct answers."):
        return self.a.post(f"/api/exams/{self.draft.pk}/send-back/", {"reason": reason}, format="json")

    def test_admin_sends_it_back_and_the_teacher_gets_the_reason(self):
        r = self.send_back()
        self.assertEqual(r.status_code, 200)
        self.draft.refresh_from_db()
        self.assertIsNone(self.draft.submitted_at)  # no longer waiting to be scheduled; the teacher can edit it
        self.assertEqual(self.draft.return_reason, "Question 3 has two correct answers.")
        self.assertEqual(self.draft.returned_to, self.teacher)
        n = Notification.objects.get(user=self.teacher, kind="exam_returned")
        self.assertIn("two correct answers", n.body)

    def test_popup_lists_it_once_and_dismiss_hides_it(self):
        self.send_back()
        items = self.t.get("/api/returned-exams/").json()["items"]
        self.assertEqual([i["id"] for i in items], [self.draft.pk])
        self.assertEqual(items[0]["reason"], "Question 3 has two correct answers.")
        self.assertEqual(self.t.post(f"/api/returned-exams/{self.draft.pk}/dismiss/", {}, format="json").status_code, 200)
        self.assertEqual(self.t.get("/api/returned-exams/").json()["items"], [])
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.return_reason, "Question 3 has two correct answers.")  # still shown on the exam itself

    def test_popup_is_for_that_teacher_only(self):
        self.send_back()
        self.assertEqual(self.client_for(self.other).get("/api/returned-exams/").json()["items"], [])

    def test_a_reason_is_needed(self):
        self.assertEqual(self.send_back("  ").status_code, 400)
        self.assertEqual(self.send_back("x" * 1001).status_code, 400)
        self.draft.refresh_from_db()
        self.assertIsNotNone(self.draft.submitted_at)

    def test_a_teacher_cannot_send_back(self):
        r = self.t.post(f"/api/exams/{self.draft.pk}/send-back/", {"reason": "Because I said so."}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_only_a_submitted_unscheduled_paper_can_be_sent_back(self):
        self.assertEqual(self.send_back().status_code, 200)
        self.assertEqual(self.send_back().status_code, 400)  # not submitted any more
        self.assertEqual(self.a.post(f"/api/exams/{self.exam.pk}/send-back/", {"reason": "Not a draft at all."}, format="json").status_code, 400)

    def test_submitting_again_clears_the_return(self):
        self.send_back()
        self.assertEqual(self.t.post(f"/api/exams/{self.draft.pk}/submit/", {}, format="json").status_code, 200)
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.return_reason, "")
        self.assertIsNone(self.draft.returned_at)
        self.assertIsNotNone(self.draft.submitted_at)
        self.assertEqual(self.t.get("/api/returned-exams/").json()["items"], [])

    def test_exam_api_shows_the_reason_to_the_teacher(self):
        self.send_back()
        d = self.t.get(f"/api/exams/{self.draft.pk}/").json()
        self.assertEqual(d["return_reason"], "Question 3 has two correct answers.")
        self.assertFalse(d["awaiting_scheduling"])
