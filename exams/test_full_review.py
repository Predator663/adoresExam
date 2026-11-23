"""The student's full-exam review and the admin switch that turns it on or off.
Run:  python manage.py test exams.test_full_review"""
from datetime import timedelta

from django.utils import timezone

from . import services
from .models import Answer, Attempt, Exam, ExamQuestion
from .tests import Base, mcq


class FullReviewTests(Base):
    def setUp(self):
        super().setUp()
        long_ago = timezone.now() - timedelta(days=3)
        Exam.objects.filter(pk=self.exam.pk).update(start_at=long_ago, end_at=long_ago + timedelta(hours=1), status=Exam.CLOSED)
        self.exam.refresh_from_db()
        eqs = list(self.exam.questions.order_by("position"))
        self.attempt = Attempt.objects.create(exam=self.exam, student=self.amina, status=Attempt.SUBMITTED,
                                              started_at=long_ago, deadline_at=long_ago + timedelta(minutes=40), submitted_at=long_ago + timedelta(minutes=10))
        Answer.objects.create(attempt=self.attempt, exam_question=eqs[0], response="b")
        Answer.objects.create(attempt=self.attempt, exam_question=eqs[1], response="a")
        services.compute_result(self.attempt)
        self.me, self.boss = self.client_for(self.amina), self.client_for(self.admin)

    def test_the_student_gets_the_whole_paper_with_answers(self):
        r = self.me.get(f"/api/results/{self.attempt.pk}/full-exam/")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual(len(d["questions"]), 2)
        self.assertEqual([q["section"] for q in d["questions"]], ["A", "A"])
        self.assertEqual(d["sections"][0]["letter"], "A")
        first, second = d["questions"]
        self.assertEqual((first["your_response"], first["marks_awarded"], first["correct_answer"]), ("b", 2, {"correct": "b"}))
        self.assertEqual((second["your_response"], second["marks_awarded"]), ("a", 0))
        self.assertEqual(d["exam"]["percent"], 50.0)

    def test_the_result_page_says_whether_the_tab_is_on(self):
        self.assertTrue(self.me.get(f"/api/results/{self.attempt.pk}/").json()["full_exam"])
        self.boss.post(f"/api/exams/{self.exam.pk}/review-switch/", {"allow": False}, format="json")
        self.assertFalse(self.me.get(f"/api/results/{self.attempt.pk}/").json()["full_exam"])

    def test_switching_it_off_closes_the_door_and_on_opens_it_again(self):
        r = self.boss.post(f"/api/exams/{self.exam.pk}/review-switch/", {"allow": False}, format="json")
        self.assertEqual((r.status_code, r.json()["allow_review"]), (200, False))
        blocked = self.me.get(f"/api/results/{self.attempt.pk}/full-exam/")
        self.assertEqual((blocked.status_code, blocked.json()["code"]), (403, "review_off"))
        self.boss.post(f"/api/exams/{self.exam.pk}/review-switch/", {"allow": True}, format="json")
        self.assertEqual(self.me.get(f"/api/results/{self.attempt.pk}/full-exam/").status_code, 200)

    def test_only_an_administrator_can_flip_the_switch(self):
        self.assertEqual(self.me.post(f"/api/exams/{self.exam.pk}/review-switch/", {"allow": False}, format="json").status_code, 403)
        self.assertEqual(self.boss.post(f"/api/exams/{self.exam.pk}/review-switch/", {"allow": "no"}, format="json").status_code, 400)
        self.exam.refresh_from_db()
        self.assertTrue(self.exam.allow_review)

    def test_nothing_is_shown_before_the_result_is_released(self):
        Exam.objects.filter(pk=self.exam.pk).update(end_at=timezone.now() + timedelta(hours=1))
        Attempt.objects.filter(pk=self.attempt.pk).update(deadline_at=timezone.now() + timedelta(hours=1))
        self.assertEqual(self.me.get(f"/api/results/{self.attempt.pk}/full-exam/").status_code, 404)

    def test_another_student_cannot_open_it(self):
        other = self.client_for(self.zawadi)
        self.assertEqual(other.get(f"/api/results/{self.attempt.pk}/full-exam/").status_code, 404)

    def test_the_exam_reports_the_switch(self):
        e = self.boss.get(f"/api/exams/{self.exam.pk}/").json()
        self.assertTrue(e["allow_review"])
