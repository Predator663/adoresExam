"""A student sees, and can start, only the exams of her OWN class (or an exam an administrator gave to her by name).
Run:  python manage.py test exams.test_class_scope"""
from datetime import timedelta

from django.contrib.auth.hashers import make_password

from academics.models import SchoolClass
from accounts.models import User
from .models import Exam, ExamQuestion
from .tests import Base, mcq


class ClassScopeTests(Base):
    """Base gives: Form 1 (self.cls) with students amina and zawadi, and self.exam, which is set for Form 1 only."""

    def setUp(self):
        super().setUp()
        self.form2 = SchoolClass.objects.create(name="Form 2", form_level=2)
        self.juma = self.student("juma", self.form2, "S10")  # a different class
        self.nobody = self.student("nobody", None, "S11")  # a student who has not been put in any class yet

    def student(self, username, school_class, index):
        return User.objects.create(username=username, role="student", school_class=school_class,
                                   password=make_password("pw-" + username + "-1"), index_number=index)

    def exam_for(self, title, classes=(), students=()):
        e = Exam.objects.create(title=title, subject=self.subject, start_at=self.start, end_at=self.start + timedelta(hours=1),
                                duration_minutes=40, status=Exam.SCHEDULED, shuffle_questions=False)
        e.classes.set(classes)
        e.students.set(students)
        ExamQuestion.objects.create(exam=e, position=1, payload=mcq())
        return e

    def seen(self, student):
        r = self.client_for(student).get("/api/student/exams/")
        self.assertEqual(r.status_code, 200)
        return {card["id"] for card in r.json()}

    def begin(self, student, exam):
        return self.client_for(student).post(f"/api/student/exams/{exam.pk}/start/", {"agree_rules": True}, format="json")

    # ---- the rule
    def test_a_student_sees_only_the_exams_of_her_own_class(self):
        form2_exam = self.exam_for("Form 2 paper", classes=[self.form2])
        self.assertEqual(self.seen(self.amina), {self.exam.pk})  # Form 1: the Form 1 exam, not the Form 2 one
        self.assertEqual(self.seen(self.zawadi), {self.exam.pk})
        self.assertEqual(self.seen(self.juma), {form2_exam.pk})  # Form 2: the other way round

    def test_an_exam_for_two_classes_shows_to_both_and_to_nobody_else(self):
        both = self.exam_for("Joint paper", classes=[self.cls, self.form2])
        form3 = SchoolClass.objects.create(name="Form 3", form_level=3)
        kim = self.student("kim", form3, "S12")
        self.assertIn(both.pk, self.seen(self.amina))
        self.assertIn(both.pk, self.seen(self.juma))
        self.assertEqual(self.seen(kim), set())

    def test_two_streams_of_one_form_are_different_classes(self):
        a = SchoolClass.objects.create(name="Form 3", form_level=3, stream="A")
        b = SchoolClass.objects.create(name="Form 3", form_level=3, stream="B")
        ann, ben = self.student("ann", a, "S13"), self.student("ben", b, "S14")
        paper = self.exam_for("Stream A paper", classes=[a])
        self.assertEqual(self.seen(ann), {paper.pk})
        self.assertEqual(self.seen(ben), set())

    def test_a_student_with_no_class_sees_no_class_exam(self):
        self.assertEqual(self.seen(self.nobody), set())

    def test_a_draft_is_never_shown_even_to_the_class_it_is_for(self):
        draft = self.exam_for("Not ready", classes=[self.cls])
        Exam.objects.filter(pk=draft.pk).update(status=Exam.DRAFT)
        self.assertNotIn(draft.pk, self.seen(self.amina))

    # ---- she cannot start an exam that is not hers either, whatever id she types
    def test_a_student_cannot_start_another_classes_exam(self):
        self.assertEqual(self.begin(self.juma, self.exam).status_code, 404)  # Juma is in Form 2, the exam is for Form 1
        self.assertEqual(self.begin(self.nobody, self.exam).status_code, 404)
        self.assertNotEqual(self.begin(self.amina, self.exam).status_code, 404)  # her own class: found (it may say "not open yet")

    def test_a_student_cannot_post_a_device_check_for_another_classes_exam(self):
        url = f"/api/student/exams/{self.exam.pk}/device-check/"
        self.assertEqual(self.client_for(self.juma).post(url, {"gps": "weak"}, format="json").status_code, 404)
        self.assertEqual(self.client_for(self.amina).post(url, {"gps": "weak"}, format="json").status_code, 200)

    # ---- an exam given to a student by name (EXM-06) still works, for that student only
    def test_an_exam_given_to_a_student_by_name_shows_to_her_only(self):
        makeup = self.exam_for("Make-up paper", students=[self.juma])
        self.assertIn(makeup.pk, self.seen(self.juma))
        self.assertNotIn(makeup.pk, self.seen(self.amina))
        self.assertEqual(self.begin(self.amina, makeup).status_code, 404)
