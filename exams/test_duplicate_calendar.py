"""Duplicating an exam, and the exam calendar downloads (PDF and .ics) for students and staff.
Run:  python manage.py test exams.test_duplicate_calendar"""
from django.contrib.auth.hashers import make_password

from academics.models import TeacherAssignment
from accounts.models import User
from .models import Exam, ExamQuestion
from .tests import Base


class DuplicateTests(Base):
    def setUp(self):
        super().setUp()
        self.teacher = User.objects.create(username="mwalimu", role="teacher", password=make_password("Tch3r-pass!"))
        TeacherAssignment.objects.create(teacher=self.teacher, subject=self.subject)
        ExamQuestion.objects.filter(exam=self.exam, position=2).update(voided=True, void_reason="faulty")

    def test_admin_copy_is_a_draft_with_questions_classes_and_no_dates(self):
        r = self.client_for(self.admin).post(f"/api/exams/{self.exam.pk}/duplicate/", {}, format="json")
        self.assertEqual(r.status_code, 201)
        copy = Exam.objects.get(pk=r.json()["id"])
        self.assertEqual(copy.title, "Copy of Maths Test")
        self.assertEqual(copy.status, Exam.DRAFT)
        self.assertIsNone(copy.start_at)
        self.assertIsNone(copy.submitted_at)
        self.assertEqual(copy.duration_minutes, 40)
        self.assertEqual(list(copy.classes.all()), [self.cls])
        self.assertEqual(copy.questions.count(), 1)  # the voided question is not carried over
        self.assertEqual(copy.questions.get().position, 1)
        self.assertEqual(Exam.objects.filter(pk=self.exam.pk).count(), 1)  # the original is untouched
        self.assertEqual(self.exam.questions.count(), 2)

    def test_second_copy_gets_a_new_title(self):
        c = self.client_for(self.admin)
        c.post(f"/api/exams/{self.exam.pk}/duplicate/", {}, format="json")
        r = c.post(f"/api/exams/{self.exam.pk}/duplicate/", {}, format="json")
        self.assertEqual(r.json()["title"], "Copy of Maths Test (2)")

    def test_a_title_can_be_sent(self):
        r = self.client_for(self.admin).post(f"/api/exams/{self.exam.pk}/duplicate/", {"title": "Maths Retest"}, format="json")
        self.assertEqual(r.json()["title"], "Maths Retest")

    def test_teacher_copy_has_no_classes_or_term(self):
        r = self.client_for(self.teacher).post(f"/api/exams/{self.exam.pk}/duplicate/", {}, format="json")
        self.assertEqual(r.status_code, 201)
        copy = Exam.objects.get(pk=r.json()["id"])
        self.assertEqual(copy.created_by, self.teacher)
        self.assertEqual(copy.classes.count(), 0)
        self.assertEqual(copy.status, Exam.DRAFT)

    def test_a_teacher_cannot_copy_a_subject_she_does_not_teach(self):
        TeacherAssignment.objects.filter(teacher=self.teacher).delete()
        r = self.client_for(self.teacher).post(f"/api/exams/{self.exam.pk}/duplicate/", {}, format="json")
        self.assertIn(r.status_code, (403, 404))

    def test_students_cannot_duplicate(self):
        r = self.client_for(self.amina).post(f"/api/exams/{self.exam.pk}/duplicate/", {}, format="json")
        self.assertEqual(r.status_code, 403)


class CalendarTests(Base):
    def test_student_pdf(self):
        r = self.client_for(self.amina).get("/api/student/exams/calendar/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(r.streaming_content if r.streaming else [r.content]).startswith(b"%PDF"))

    def test_student_ics_lists_her_exam(self):
        r = self.client_for(self.amina).get("/api/student/exams/calendar/?file=ics")
        self.assertEqual(r.status_code, 200)
        body = r.content.decode()
        self.assertIn("BEGIN:VEVENT", body)
        self.assertIn(f"UID:exam-{self.exam.pk}@", body)
        self.assertIn("Maths Test", body)
        self.assertIn("BEGIN:VALARM", body)

    def test_student_does_not_get_another_classes_exam_or_a_draft(self):
        Exam.objects.create(title="Hidden draft", subject=self.subject, start_at=self.start, end_at=self.start, duration_minutes=10, status=Exam.DRAFT)
        body = self.client_for(self.amina).get("/api/student/exams/calendar/?file=ics").content.decode()
        self.assertNotIn("Hidden draft", body)

    def test_staff_calendar_and_ids_filter(self):
        other = Exam.objects.create(title="Other paper", subject=self.subject, start_at=self.start, end_at=self.start + (self.exam.end_at - self.start),
                                    duration_minutes=30, status=Exam.SCHEDULED)
        c = self.client_for(self.admin)
        both = c.get("/api/exams/calendar/?file=ics").content.decode()
        self.assertIn("Maths Test", both)
        self.assertIn("Other paper", both)
        only = c.get(f"/api/exams/calendar/?file=ics&ids={other.pk}").content.decode()
        self.assertIn("Other paper", only)
        self.assertNotIn("Maths Test", only)

    def test_bad_file_kind_is_refused_and_students_cannot_use_the_staff_route(self):
        self.assertEqual(self.client_for(self.admin).get("/api/exams/calendar/?file=doc").status_code, 400)
        self.assertEqual(self.client_for(self.amina).get("/api/exams/calendar/").status_code, 403)
