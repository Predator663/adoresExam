"""A teacher uses only her own questions. To use a colleague's she asks; the owner approves or denies.
Run:  python manage.py test questions.test_question_shares"""
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from academics.models import Subject, TeacherAssignment
from accounts.models import User
from core.models import AuditLog
from exams.models import Exam, ExamQuestion
from notifications.models import Notification
from .models import Question, QuestionShare


class ShareTests(TestCase):
    def setUp(self):
        self.maths, self.physics = Subject.objects.create(name="Maths"), Subject.objects.create(name="Physics")
        mk = lambda n, role="teacher": User.objects.create(username=n, first_name=n.title(), role=role, password=make_password("Pass-word-1"))
        self.ann, self.ben, self.cat, self.root = mk("ann"), mk("ben"), mk("cat"), mk("root", "admin")
        for t in (self.ann, self.ben):
            TeacherAssignment.objects.create(teacher=t, subject=self.maths)
        TeacherAssignment.objects.create(teacher=self.cat, subject=self.physics)
        mkq = lambda by, subj=self.maths, status=Question.APPROVED, prompt="p": Question.objects.create(
            subject=subj, created_by=by, status=status, qtype="true_false", prompt=prompt, answer={"correct": True}, explanation="because")
        self.a1, self.b1, self.b_draft, self.c1 = mkq(self.ann), mkq(self.ben, prompt="ben's"), mkq(self.ben, status=Question.DRAFT), mkq(self.cat, self.physics)
        self.exam = Exam.objects.create(title="Ann's test", subject=self.maths, created_by=self.ann)

    def api(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def ask(self, user, question, note=""):
        return self.api(user).post("/api/question-shares/", {"question": question.pk, "note": note}, format="json")

    def paper(self, user, ids):
        return self.api(user).post(f"/api/exams/{self.exam.pk}/paper/", {"question_ids": ids}, format="json")

    # ---- the rule
    def test_a_teacher_cannot_put_a_colleagues_question_into_her_exam(self):
        r = self.paper(self.ann, [self.a1.pk, self.b1.pk])
        self.assertEqual(r.status_code, 400)
        self.assertIn("question_ids", r.json())
        self.assertEqual(self.exam.questions.count(), 0)
        self.assertEqual(self.paper(self.ann, [self.a1.pk]).status_code, 200)  # her own is fine

    def test_random_rules_only_draw_from_my_own_questions(self):
        r = self.api(self.ann).post(f"/api/exams/{self.exam.pk}/pick/", {"rules": [{"count": 2}]}, format="json")
        self.assertEqual(r.status_code, 400)  # only one of hers matches; ben's is not in her pool
        r = self.api(self.ann).post(f"/api/exams/{self.exam.pk}/pick/", {"rules": [{"count": 1}]}, format="json")
        self.assertEqual([x["id"] for x in r.json()], [self.a1.pk])

    def test_an_administrator_may_use_any_question(self):
        self.assertEqual(self.paper(self.root, [self.a1.pk, self.b1.pk]).status_code, 200)

    # ---- asking
    def test_request_then_approve_lets_her_use_it(self):
        r = self.ask(self.ann, self.b1, "for the Form 2 test")
        self.assertEqual(r.status_code, 201, r.content)
        share = QuestionShare.objects.get()
        self.assertEqual((share.requester, share.owner, share.status), (self.ann, self.ben, "pending"))
        self.assertTrue(Notification.objects.filter(user=self.ben, kind="question_share").exists())
        self.assertEqual(r.json()["question"]["answer"], {})  # still hidden while waiting
        self.assertEqual(self.paper(self.ann, [self.b1.pk]).status_code, 400)  # waiting is not permission
        ok = self.api(self.ben).post(f"/api/question-shares/{share.pk}/approve/", {"reply": "Go ahead"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["status"], "approved")
        self.assertTrue(Notification.objects.filter(user=self.ann, kind="question_share").exists())
        self.assertEqual(self.paper(self.ann, [self.b1.pk]).status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="question.share.approve").exists())

    def test_deny_blocks_and_she_may_ask_again(self):
        self.ask(self.ann, self.b1)
        s = QuestionShare.objects.get()
        self.assertEqual(self.api(self.ben).post(f"/api/question-shares/{s.pk}/deny/", {"reply": "Not yet"}, format="json").json()["status"], "denied")
        self.assertEqual(self.paper(self.ann, [self.b1.pk]).status_code, 400)
        again = self.ask(self.ann, self.b1, "please")
        self.assertEqual(again.status_code, 201)
        self.assertEqual(QuestionShare.objects.count(), 1)  # the same row, back to waiting
        self.assertEqual(QuestionShare.objects.get().status, "pending")

    def test_revoke_takes_the_permission_back_but_an_exam_already_built_keeps_its_copy(self):
        self.ask(self.ann, self.b1)
        s = QuestionShare.objects.get()
        self.api(self.ben).post(f"/api/question-shares/{s.pk}/approve/", {}, format="json")
        self.assertEqual(self.paper(self.ann, [self.b1.pk]).status_code, 200)
        self.api(self.ben).post(f"/api/question-shares/{s.pk}/revoke/", {}, format="json")
        self.assertEqual(QuestionShare.objects.get().status, "revoked")
        self.assertEqual(self.paper(self.ann, [self.b1.pk, self.a1.pk]).status_code, 200)  # already in this exam: not blocked
        self.assertTrue(ExamQuestion.objects.filter(exam=self.exam, source=self.b1).exists())
        other = Exam.objects.create(title="Another", subject=self.maths, created_by=self.ann)
        r = self.api(self.ann).post(f"/api/exams/{other.pk}/paper/", {"question_ids": [self.b1.pk]}, format="json")
        self.assertEqual(r.status_code, 400)  # but she cannot use it in a NEW exam

    def test_only_the_owner_decides(self):
        self.ask(self.ann, self.b1)
        s = QuestionShare.objects.get()
        self.assertEqual(self.api(self.ann).post(f"/api/question-shares/{s.pk}/approve/", {}, format="json").status_code, 403)  # not even the requester
        self.assertEqual(self.api(self.cat).post(f"/api/question-shares/{s.pk}/approve/", {}, format="json").status_code, 403)
        self.assertEqual(self.api(self.root).post(f"/api/question-shares/{s.pk}/approve/", {}, format="json").status_code, 200)  # an administrator may

    def test_requester_can_cancel_a_waiting_request(self):
        self.ask(self.ann, self.b1)
        s = QuestionShare.objects.get()
        self.assertEqual(self.api(self.ben).post(f"/api/question-shares/{s.pk}/cancel/", {}, format="json").status_code, 400)  # only the asker
        self.assertEqual(self.api(self.ann).post(f"/api/question-shares/{s.pk}/cancel/", {}, format="json").json()["status"], "cancelled")

    def test_what_cannot_be_requested(self):
        self.assertEqual(self.ask(self.ann, self.a1).status_code, 400)       # her own
        self.assertEqual(self.ask(self.ann, self.b_draft).status_code, 400)  # a colleague's draft
        self.assertEqual(self.ask(self.ann, self.c1).status_code, 403)       # a subject she does not teach
        self.assertEqual(self.ask(self.root, self.b1).status_code, 400)      # administrators do not need to
        self.ask(self.ann, self.b1)
        self.assertEqual(self.ask(self.ann, self.b1).status_code, 400)       # already waiting

    # ---- seeing
    def test_inbox_and_outbox(self):
        self.ask(self.ann, self.b1, "hello")
        inbox = self.api(self.ben).get("/api/question-shares/?box=incoming").json()
        self.assertEqual(inbox["count"], 1)
        self.assertEqual(inbox["results"][0]["requester"], "Ann")
        self.assertEqual(inbox["results"][0]["question"]["answer"], {"correct": True})  # the owner sees her own question fully
        self.assertEqual(self.api(self.ann).get("/api/question-shares/?box=incoming").json()["count"], 0)
        out = self.api(self.ann).get("/api/question-shares/?box=outgoing").json()
        self.assertEqual(out["results"][0]["owner"], "Ben")
        self.assertEqual(out["results"][0]["question"]["answer"], {})
        self.assertEqual(self.api(self.ben).get("/api/question-shares/counts/").json()["incoming_pending"], 1)

    def test_browse_shows_colleagues_approved_questions_in_my_subjects_with_hidden_answers(self):
        res = self.api(self.ann).get("/api/question-shares/browse/").json()
        ids = {x["id"] for x in res["results"]}
        self.assertEqual(ids, {self.b1.pk})  # not her own, not ben's draft, not physics
        self.assertEqual(res["results"][0]["answer"], {})
        self.ask(self.ann, self.b1)
        res = self.api(self.ann).get("/api/question-shares/browse/").json()
        self.assertEqual(res["results"][0]["share"]["status"], "pending")
        self.assertEqual(self.api(self.ann).get("/api/question-shares/browse/?state=none").json()["count"], 0)

    def test_shared_question_appears_on_the_shared_shelf_with_its_answer_and_counts(self):
        self.ask(self.ann, self.b1)
        self.api(self.ben).post(f"/api/question-shares/{QuestionShare.objects.get().pk}/approve/", {}, format="json")
        r = self.api(self.ann).get(f"/api/exams/{self.exam.pk}/bank/", {"scope": "shared"}).json()
        self.assertEqual([x["id"] for x in r["results"]], [self.b1.pk])
        self.assertEqual(r["results"][0]["answer"], {"correct": True})
        self.assertEqual(r["counts"], {"mine": 1, "shared": 1, "others": 0})

    def test_a_questions_list_never_includes_shared_questions(self):
        self.ask(self.ann, self.b1)
        self.api(self.ben).post(f"/api/question-shares/{QuestionShare.objects.get().pk}/approve/", {}, format="json")
        ids = {x["id"] for x in self.api(self.ann).get("/api/questions/").json()}
        self.assertEqual(ids, {self.a1.pk})
        ids = {x["id"] for x in self.api(self.ann).get(f"/api/questions/?ids={self.b1.pk}").json()}  # but the builder can re-load it by id
        self.assertEqual(ids, {self.b1.pk})
