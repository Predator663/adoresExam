from django.test import TestCase
from rest_framework.exceptions import ValidationError

from .validation import validate_question


class QuestionValidationTests(TestCase):
    def test_mcq_needs_a_correct_answer(self):
        content = {"options": [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}]}
        with self.assertRaises(ValidationError):
            validate_question("mcq_single", content, {})
        c, a = validate_question("mcq_single", content, {"correct": "a"})
        self.assertEqual(a, {"correct": "a"})

    def test_image_requires_alt_text(self):
        content = {"options": [{"id": "a", "text": "", "image": "/m/x.webp"}, {"id": "b", "text": "y"}]}
        with self.assertRaises(ValidationError):
            validate_question("mcq_single", content, {"correct": "a"})

    def test_script_in_text_is_stripped(self):
        content = {"options": [{"id": "a", "text": "<script>alert(1)</script>ok"}, {"id": "b", "text": "y"}]}
        c, _ = validate_question("mcq_single", content, {"correct": "a"})
        self.assertNotIn("<script>", c["options"][0]["text"])

    def test_ordering_answer_derived_from_authored_order(self):
        items = [{"id": "1", "text": "first"}, {"id": "2", "text": "second"}]
        _, a = validate_question("ordering", {"items": items}, {})
        self.assertEqual(a["order"], ["1", "2"])

    def test_matching_must_cover_every_left_item(self):
        content = {"left": [{"id": "l1", "text": "a"}, {"id": "l2", "text": "b"}],
                   "right": [{"id": "r1", "text": "x"}, {"id": "r2", "text": "y"}]}
        with self.assertRaises(ValidationError):
            validate_question("matching", content, {"pairs": {"l1": "r1"}})
        validate_question("matching", content, {"pairs": {"l1": "r1", "l2": "r2"}})


class QuestionBankScopeTests(TestCase):
    """A teacher sees only her assigned subjects; her own questions apart from colleagues'; only she edits or deletes hers."""

    def setUp(self):
        from django.contrib.auth.hashers import make_password
        from rest_framework.authtoken.models import Token
        from rest_framework.test import APIClient

        from academics.models import Subject, TeacherAssignment
        from accounts.models import User
        from .models import Question

        self.Question, self.Token, self.APIClient = Question, Token, APIClient
        self.maths, self.english = Subject.objects.create(name="Mathematics"), Subject.objects.create(name="English")
        mk = lambda n, role: User.objects.create(username=n, first_name=n.title(), role=role, password=make_password("Pass-word-1"))
        self.ann, self.ben, self.admin = mk("ann", "teacher"), mk("ben", "teacher"), mk("root", "admin")
        for t in (self.ann, self.ben):
            TeacherAssignment.objects.create(teacher=t, subject=self.maths)
        TeacherAssignment.objects.create(teacher=self.ben, subject=self.english)
        self.ann_q = self.q(self.maths, self.ann, "approved")
        self.ann_draft = self.q(self.maths, self.ann, "draft")
        self.ben_q = self.q(self.maths, self.ben, "approved")
        self.ben_draft = self.q(self.maths, self.ben, "draft")
        self.eng_q = self.q(self.english, self.ben, "approved")

    def q(self, subject, user, status):
        return self.Question.objects.create(
            subject=subject, created_by=user, status=status, qtype="mcq_single", prompt="p",
            content={"options": [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}]}, answer={"correct": "a"})

    def client(self, user):
        c = self.APIClient()
        c.credentials(HTTP_AUTHORIZATION="Token " + self.Token.objects.get_or_create(user=user)[0].key)
        return c

    def ids(self, user, qs=""):
        return {r["id"] for r in self.client(user).get("/api/questions/" + qs).json()}

    def test_teacher_sees_only_assigned_subjects(self):
        self.assertNotIn(self.eng_q.pk, self.ids(self.ann))
        self.assertIn(self.eng_q.pk, self.ids(self.ben))

    def test_mine_and_others_are_separate(self):
        self.assertEqual(self.ids(self.ann, "?scope=mine"), {self.ann_q.pk, self.ann_draft.pk})
        self.assertEqual(self.ids(self.ann, "?scope=others"), {self.ben_q.pk})  # the colleague's draft stays private

    def test_only_the_author_can_edit_delete_or_submit(self):
        c = self.client(self.ann)
        self.assertEqual(c.patch(f"/api/questions/{self.ben_q.pk}/", {"marks": 5}, format="json").status_code, 403)
        self.assertEqual(c.delete(f"/api/questions/{self.ben_q.pk}/").status_code, 403)
        self.assertEqual(c.post(f"/api/questions/{self.ben_q.pk}/submit/", {}, format="json").status_code, 403)
        self.assertEqual(c.patch(f"/api/questions/{self.ann_q.pk}/", {"marks": 5}, format="json").status_code, 200)
        self.assertEqual(c.delete(f"/api/questions/{self.ann_q.pk}/").status_code, 204)
        self.assertEqual(c.get(f"/api/questions/{self.eng_q.pk}/").status_code, 404)  # not her subject

    def test_can_edit_flag_drives_the_buttons(self):
        rows = {r["id"]: r for r in self.client(self.ann).get("/api/questions/").json()}
        self.assertTrue(rows[self.ann_q.pk]["can_edit"] and rows[self.ann_q.pk]["is_mine"])
        self.assertFalse(rows[self.ben_q.pk]["can_edit"])
        self.assertEqual(rows[self.ben_q.pk]["created_by_name"], "Ben")

    def test_admin_keeps_full_control(self):
        self.assertTrue({self.eng_q.pk, self.ben_draft.pk} <= self.ids(self.admin))
        self.assertEqual(self.client(self.admin).patch(f"/api/questions/{self.ben_q.pk}/", {"marks": 2}, format="json").status_code, 200)
