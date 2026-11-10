"""The exam builder's two question shelves (mine / others) and the teacher's server-side draft."""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from academics.models import Subject, TeacherAssignment
from accounts.models import User
from questions.models import Question
from .models import BuilderDraft, Exam


def q(subject, by, status=Question.APPROVED, prompt="What is 2+2?"):
    return Question.objects.create(
        subject=subject, qtype="true_false", prompt=prompt, answer={"correct": True}, status=status, created_by=by)


class BuilderTests(TestCase):
    def setUp(self):
        self.maths, self.physics = Subject.objects.create(name="Maths"), Subject.objects.create(name="Physics")
        mk = lambda n: User.objects.create(username=n, role="teacher", password=make_password("pw-teacher-1"))
        self.a, self.b, self.c = mk("a"), mk("b"), mk("c")
        for t in (self.a, self.b):
            TeacherAssignment.objects.create(teacher=t, subject=self.maths)
        TeacherAssignment.objects.create(teacher=self.c, subject=self.physics)
        self.exam = Exam.objects.create(title="T", subject=self.maths)
        self.mine = [q(self.maths, self.a, prompt=f"mine {i}") for i in range(2)]
        self.theirs = [q(self.maths, self.b, prompt="theirs")]
        q(self.maths, self.b, status=Question.DRAFT, prompt="their private draft")  # never on a colleague's shelf
        q(self.physics, self.c, prompt="other subject")
        self.api = APIClient()
        self.api.force_authenticate(self.a)

    def bank(self, **p):
        r = self.api.get(f"/api/exams/{self.exam.pk}/bank/", p)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_mine_shelf_only_has_my_questions(self):
        r = self.bank(scope="mine")
        self.assertEqual({x["id"] for x in r["results"]}, {x.pk for x in self.mine})
        self.assertTrue(all(x["is_mine"] for x in r["results"]))

    def test_my_own_drafts_show_on_my_shelf_only(self):
        mine_draft = q(self.maths, self.a, status=Question.DRAFT, prompt="my draft")
        r = self.bank(scope="mine")
        self.assertIn(mine_draft.pk, {x["id"] for x in r["results"]})
        self.assertEqual({x["status"] for x in r["results"] if x["id"] == mine_draft.pk}, {"draft"})
        self.assertEqual(r["counts"]["mine"], 3)
        other = APIClient(); other.force_authenticate(self.b)  # never on a colleague's shelf
        seen = {x["id"] for x in other.get(f"/api/exams/{self.exam.pk}/bank/", {"scope": "others"}).json()["results"]}
        self.assertNotIn(mine_draft.pk, seen)

    def test_others_shelf_has_colleagues_approved_questions_of_this_subject(self):
        r = self.bank(scope="others")
        self.assertEqual({x["id"] for x in r["results"]}, {x.pk for x in self.theirs})
        self.assertFalse(any(x["is_mine"] for x in r["results"]))
        self.assertEqual(r["results"][0]["created_by_name"], "b")

    def test_counts_cover_both_shelves_whatever_the_filters(self):
        r = self.bank(scope="mine", q="nothing matches this")
        self.assertEqual(r["count"], 0)
        self.assertEqual(r["counts"], {"mine": 2, "others": 1})  # b's private draft is on nobody else's shelf

    def test_no_scope_still_returns_everything_approved(self):
        self.assertEqual(self.bank()["count"], 3)

    def test_draft_round_trip_is_per_teacher(self):
        url = f"/api/exams/{self.exam.pk}/draft/"
        self.assertIsNone(self.api.get(url).json()["data"])
        body = {"data": {"tab": "bulk", "sel": [self.mine[0].pk], "bulk": {"cards": [{"key": "x"}]}}}
        self.assertEqual(self.api.put(url, body, format="json").status_code, 200)
        self.assertEqual(self.api.get(url).json()["data"]["tab"], "bulk")
        other = APIClient(); other.force_authenticate(self.b)  # a colleague never sees it
        self.assertIsNone(other.get(url).json()["data"])
        self.api.put(url, {"data": {"tab": "mine"}}, format="json")  # saving again replaces, never duplicates
        self.assertEqual(BuilderDraft.objects.filter(exam=self.exam, user=self.a).count(), 1)
        self.assertEqual(self.api.delete(url).status_code, 204)
        self.assertIsNone(self.api.get(url).json()["data"])

    def test_draft_rejects_non_objects_and_teachers_of_other_subjects(self):
        url = f"/api/exams/{self.exam.pk}/draft/"
        self.assertEqual(self.api.put(url, {"data": "nope"}, format="json").status_code, 400)
        outsider = APIClient(); outsider.force_authenticate(self.c)
        self.assertIn(outsider.get(url).status_code, (403, 404))
