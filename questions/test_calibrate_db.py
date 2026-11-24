"""Measured difficulty end to end (needs the database):  python manage.py test questions.test_calibrate_db"""
import random
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone

from academics.models import SchoolClass, Subject
from accounts.models import User
from exams.models import Answer, Attempt, Exam, ExamQuestion
from gamification import services as gam
from . import calibrate, calibration as cal
from .models import Question


class MeasuredDifficultyTests(TestCase):
    def setUp(self):
        self.cls = SchoolClass.objects.create(name="Form 1", form_level=1)
        self.maths = Subject.objects.create(name="Mathematics")
        self.students = [User.objects.create(username=f"s{i}", role="student", school_class=self.cls, index_number=f"I{i}",
                                             password=make_password("x")) for i in range(90)]
        # the teacher typed "medium" for every question: the model must ignore that and read the answers instead
        self.truth = [-2.0] * 6 + [0.0] * 4 + [2.0] * 6
        self.qs = [Question.objects.create(subject=self.maths, form_level=1, topic="Algebra", difficulty="medium", marks=2, qtype="mcq_single",
                                           prompt=f"Q{i}?", content={"options": [{"id": "a", "text": "1"}]}, answer={"correct": "a"},
                                           status=Question.APPROVED, practice_eligible=True) for i in range(len(self.truth))]
        self.now = timezone.now()

    def make_exam(self, status, voided=()):
        exam = Exam.objects.create(title="E", subject=self.maths, start_at=self.now - timedelta(days=2), end_at=self.now - timedelta(days=1),
                                   duration_minutes=30, status=status)
        eqs = [ExamQuestion.objects.create(exam=exam, position=i + 1, source=q, voided=i in voided,
                                           payload={"qtype": "mcq_single", "marks": 2, "topic": "Algebra", "prompt": "x", "content": {}, "answer": {}})
               for i, q in enumerate(self.qs)]
        rng = random.Random(11)
        for s in self.students:
            ability = rng.gauss(0, 0.8)
            att = Attempt.objects.create(exam=exam, student=s, status=Attempt.SUBMITTED, started_at=exam.start_at, deadline_at=exam.end_at)
            for eq, b in zip(eqs, self.truth):
                right = rng.random() < cal.sigmoid(ability - b)
                Answer.objects.create(attempt=att, exam_question=eq, response="a", marks_awarded=2.0 if right else 0.0)
        return exam

    def test_easy_medium_and_hard_are_learned_from_answers_not_from_the_teacher(self):
        self.make_exam(Exam.PUBLISHED)
        summary = calibrate.run()
        self.assertEqual(summary["measured"], 16)
        got = [Question.objects.get(pk=q.pk) for q in self.qs]
        easy, medium, hard = [g.ml_label for g in got[:6]], [g.ml_label for g in got[6:10]], [g.ml_label for g in got[10:]]
        # a question answered by 90 students can still land one step off by chance, but never at the opposite end
        self.assertGreaterEqual(easy.count("easy"), 5)
        self.assertGreaterEqual(hard.count("hard"), 5)
        self.assertNotIn("hard", easy)
        self.assertNotIn("easy", hard)
        self.assertNotIn("easy", medium)
        self.assertTrue(all(g.ml_source == "data" and g.ml_samples == 90 for g in got))
        self.assertTrue(all(g.difficulty == "medium" for g in got))          # the teacher's own setting is never touched
        self.assertEqual(got[5].effective_difficulty, got[5].ml_label)       # but the app uses the measured one
        self.assertEqual(gam._practice_payload(got[12])["difficulty"], got[12].ml_label)
        self.assertEqual(summary["predicted"], 0)                            # too few measured questions to predict anything

    def test_unpublished_exams_and_voided_questions_do_not_count(self):
        self.make_exam(Exam.SCHEDULED)
        self.assertEqual(calibrate.run()["measured"], 0)
        Question.objects.update(ml_label="")
        self.make_exam(Exam.PUBLISHED, voided=(0, 1))
        calibrate.run()
        self.assertEqual(Question.objects.get(pk=self.qs[0].pk).ml_label, "")   # voided: nobody's answer counts
        self.assertEqual(Question.objects.get(pk=self.qs[5].pk).ml_label, "easy")

    def test_dry_run_changes_nothing_and_few_answers_means_no_label(self):
        self.make_exam(Exam.PUBLISHED)
        self.assertEqual(calibrate.run(dry_run=True)["measured"], 16)
        self.assertEqual(Question.objects.exclude(ml_label="").count(), 0)
        Answer.objects.filter(attempt__student__in=self.students[5:]).delete()   # only 5 students answered: below the minimum
        self.assertEqual(calibrate.run()["measured"], 0)
