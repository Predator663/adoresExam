"""The Topic filter of the question bank is filled from the database, and the Teacher / Form filters have what they need.
Run:  python manage.py test exams.test_filter_options"""
from django.contrib.auth.hashers import make_password

from academics.models import Subject, TeacherAssignment
from accounts.models import User
from questions.models import Question
from .tests import Base


class FilterOptionTests(Base):
    def q(self, subject, topic, form_level=1, status=Question.APPROVED, by=None):
        return Question.objects.create(subject=subject, form_level=form_level, topic=topic, qtype="mcq_single", prompt="?", status=status,
                                       content={"options": [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}]}, answer={"correct": "a"},
                                       created_by=by or self.admin)

    def test_topics_come_from_the_question_bank_sorted_and_without_blanks(self):
        self.q(self.subject, "Geometry"); self.q(self.subject, "algebra"); self.q(self.subject, "Geometry"); self.q(self.subject, "")
        r = self.client_for(self.admin).get("/api/questions/topics/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), ["algebra", "Geometry"])

    def test_topics_narrow_by_subject_and_form(self):
        physics = Subject.objects.create(name="Physics")
        self.q(self.subject, "Algebra", 1); self.q(self.subject, "Calculus", 4); self.q(physics, "Optics", 1)
        c = self.client_for(self.admin)
        self.assertEqual(c.get(f"/api/questions/topics/?subject={self.subject.pk}").json(), ["Algebra", "Calculus"])
        self.assertEqual(c.get(f"/api/questions/topics/?subject={self.subject.pk}&form_level=4").json(), ["Calculus"])

    def test_a_teacher_sees_topics_of_her_own_subjects_only(self):
        physics = Subject.objects.create(name="Physics")
        self.q(self.subject, "Algebra"); self.q(physics, "Optics")
        teacher = User.objects.create(username="t1", role="teacher", password=make_password("Teach3r-pass!"))
        TeacherAssignment.objects.create(teacher=teacher, subject=self.subject)
        self.assertEqual(self.client_for(teacher).get("/api/questions/topics/").json(), ["Algebra"])

    def test_students_cannot_read_the_topic_list(self):
        self.assertEqual(self.client_for(self.amina).get("/api/questions/topics/").status_code, 403)

    def test_the_teacher_list_is_complete_for_an_administrator(self):
        User.objects.create(username="t2", role="teacher", first_name="Mary", last_name="Kimaro", password=make_password("Teach3r-pass!"))
        names = {t["username"] for t in self.client_for(self.admin).get("/api/teachers/").json()}  # no ?page=, so the whole list comes back
        self.assertIn("t2", names)
