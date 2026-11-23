"""The student's results list, the summary on top of it, and the extras on one result.
Run:  python manage.py test exams.test_myresults"""
from datetime import timedelta

from django.test import SimpleTestCase
from django.utils import timezone

from . import myresults, services
from .models import Answer, Attempt, Exam
from .tests import Base


def row(marks=2, got=0, voided=False, skipped=False, timed_out=False, resp="a"):
    return {"voided": voided, "marks": marks, "marks_awarded": got, "skipped": skipped, "timed_out": timed_out, "your_response": resp}


class BreakdownTests(SimpleTestCase):
    def test_each_kind_of_question(self):
        rows = [row(got=2), row(got=1), row(got=0), row(got=0, skipped=True), row(got=0, resp=None), row(got=0, resp={"a": " "}), row(voided=True)]
        self.assertEqual(myresults.breakdown(rows), {"full": 1, "part": 1, "none": 1, "skip": 3, "void": 1})


class MyResultsTests(Base):
    def setUp(self):
        super().setUp()
        long_ago = timezone.now() - timedelta(days=3)
        Exam.objects.filter(pk=self.exam.pk).update(start_at=long_ago, end_at=long_ago + timedelta(hours=1), status=Exam.CLOSED)
        self.exam.refresh_from_db()
        eqs = list(self.exam.questions.order_by("position"))
        self.attempt = Attempt.objects.create(exam=self.exam, student=self.amina, status=Attempt.SUBMITTED, started_at=long_ago,
                                              deadline_at=long_ago + timedelta(minutes=40), submitted_at=long_ago + timedelta(minutes=10))
        Answer.objects.create(attempt=self.attempt, exam_question=eqs[0], response="b")
        Answer.objects.create(attempt=self.attempt, exam_question=eqs[1], response="a")
        services.compute_result(self.attempt)
        self.me = self.client_for(self.amina)

    def test_the_list_has_scores_and_can_be_searched(self):
        rows = self.me.get("/api/results/").json()
        self.assertEqual((len(rows), rows[0]["percent"], rows[0]["total"]), (1, 50.0, 4.0))
        self.assertEqual(len(self.me.get("/api/results/?q=zzzz-nothing").json()), 0)
        self.assertEqual(len(self.me.get(f"/api/results/?subject={rows[0]['subject']}&sort=best").json()), 1)
        self.assertEqual(len(self.me.get("/api/results/?subject=Nope").json()), 0)

    def test_the_summary(self):
        d = self.me.get("/api/results/summary/").json()
        self.assertEqual((d["count"], d["average"], d["trend"], d["best"]["percent"]), (1, 50.0, [50.0], 50.0))
        self.assertEqual(d["subjects"][0]["count"], 1)
        empty = self.client_for(self.zawadi).get("/api/results/summary/").json()
        self.assertEqual((empty["count"], empty["best"], empty["subjects"]), (0, None, []))

    def test_one_result_says_how_the_questions_went(self):
        d = self.me.get(f"/api/results/{self.attempt.pk}/").json()
        self.assertEqual(d["breakdown"], {"full": 1, "part": 0, "none": 1, "skip": 0, "void": 0})
        self.assertEqual(d["duration_minutes"], self.exam.duration_minutes)
        self.assertIsNone(d["previous"])

    def test_the_previous_exam_in_the_subject(self):
        before = timezone.now() - timedelta(days=30)
        old = Exam.objects.create(title="Older test", subject=self.exam.subject, created_by=self.admin, start_at=before, end_at=before + timedelta(hours=1),
                                  duration_minutes=30, status=Exam.CLOSED)
        a = Attempt.objects.create(exam=old, student=self.amina, status=Attempt.SUBMITTED, started_at=before, deadline_at=before, submitted_at=before)
        from .models import Result
        Result.objects.create(attempt=a, exam=old, student=self.amina, score=1, total=4, percent=25.0, grade="E", points=1, passed=False, scale_snapshot={}, time_taken_seconds=60)
        d = self.me.get(f"/api/results/{self.attempt.pk}/").json()
        self.assertEqual((d["previous"]["exam"], d["previous"]["delta"]), ("Older test", 25.0))
