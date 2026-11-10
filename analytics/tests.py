"""Phase 2 analytics tests. Run:  python manage.py test analytics"""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone

from academics.models import SchoolClass, Subject, TeacherAssignment
from accounts.models import User
from exams import services
from exams.models import Exam, ExamQuestion
from exams.tests import mcq
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient


class AnalyticsBase(TestCase):
    def setUp(self):
        self.cls_a = SchoolClass.objects.create(name="Form 1", stream="A", form_level=1)
        self.cls_b = SchoolClass.objects.create(name="Form 1", stream="B", form_level=1)
        self.maths = Subject.objects.create(name="Mathematics")
        self.english = Subject.objects.create(name="English")
        mk = lambda name, cls, idx: User.objects.create(
            username=name, first_name=name.title(), last_name="Test", role="student", school_class=cls,
            index_number=idx, password=make_password("pw-" + name + "-1"))
        self.amina, self.zawadi = mk("amina", self.cls_a, "S1"), mk("zawadi", self.cls_b, "S2")
        self.teacher = User.objects.create(username="teach", role="teacher", password=make_password("Teach-pass-1"))
        TeacherAssignment.objects.create(teacher=self.teacher, subject=self.maths, school_class=self.cls_a)
        self.admin = User.objects.create(username="admin1", role="admin", password=make_password("Adm1n-pass!"))
        self.end = timezone.now() - timedelta(hours=1)
        self.start = self.end - timedelta(hours=1)

    def client_for(self, user):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Token " + Token.objects.get_or_create(user=user)[0].key)
        return c

    def make_exam(self, subject, title="Test", picks=None, publish=True):
        """picks: {student: [answer for q1, answer for q2]}; correct answer is 'b'."""
        exam = Exam.objects.create(title=title, subject=subject, start_at=self.start, end_at=self.end,
                                   duration_minutes=30, status=Exam.SCHEDULED, shuffle_questions=False)
        exam.classes.add(self.cls_a, self.cls_b)
        for i in (1, 2):
            ExamQuestion.objects.create(exam=exam, position=i, payload=mcq())
        attempts = {}
        for student, answers in (picks or {}).items():
            a = services.start_attempt(exam, student, now=self.start + timedelta(minutes=1))
            for qid, ans in zip(a.order, answers):
                services.submit_answer(a.pk, student, qid, ans, now=self.start + timedelta(minutes=5))
            attempts[student.pk] = a
        if publish:
            services.sync_exam(exam)
            exam.refresh_from_db()
            assert exam.status == Exam.PUBLISHED, exam.status
        return exam, attempts


class TeacherScopeTests(AnalyticsBase):
    def test_teacher_sees_only_assigned_subject_and_class(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"], self.zawadi: ["a", "a"]})
        self.make_exam(self.english, "Eng", picks={self.amina: ["b", "b"]})
        c = self.client_for(self.teacher)
        d = c.get(f"/api/analytics/subjects/{self.maths.pk}/").json()
        self.assertEqual(d["count"], 1)  # only Form 1 A (amina); zawadi is in B
        self.assertEqual(d["average"], 100.0)
        self.assertEqual(c.get(f"/api/analytics/subjects/{self.english.pk}/").status_code, 404)
        names = [s["name"] for s in c.get("/api/analytics/subjects/").json()]
        self.assertEqual(names, ["Mathematics"])

    def test_admin_sees_everything(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"], self.zawadi: ["a", "a"]})
        d = self.client_for(self.admin).get(f"/api/analytics/subjects/{self.maths.pk}/").json()
        self.assertEqual(d["count"], 2)
        self.assertEqual(d["average"], 50.0)
        self.assertEqual(len(d["by_class"]), 2)

    def test_nothing_before_results_are_published(self):
        exam, _ = self.make_exam(self.maths, picks={self.amina: ["b", "b"]}, publish=False)
        # still inside the exam window, so it is not Published (and cannot be published by a request)
        Exam.objects.filter(pk=exam.pk).update(end_at=timezone.now() + timedelta(hours=1), status=Exam.LIVE)
        c = self.client_for(self.teacher)
        self.assertEqual(c.get(f"/api/analytics/subjects/{self.maths.pk}/").json()["count"], 0)
        self.assertEqual(c.get(f"/api/analytics/exams/{exam.pk}/questions/").status_code, 404)
        self.assertEqual(c.get(f"/api/analytics/exams/{exam.pk}/integrity/").status_code, 404)

    def test_students_list_flags_and_profile(self):
        self.make_exam(self.maths, picks={self.amina: ["a", "a"]})  # 0 percent
        c = self.client_for(self.teacher)
        rows = c.get(f"/api/analytics/subjects/{self.maths.pk}/students/").json()
        self.assertEqual([r["name"] for r in rows], ["Amina Test"])  # zawadi is not in her class
        self.assertEqual(rows[0]["flag"], "needs_support")
        prof = c.get(f"/api/analytics/subjects/{self.maths.pk}/students/{self.amina.pk}/").json()
        self.assertEqual(prof["participation"], {"taken": 1, "eligible": 1})
        self.assertEqual(c.get(f"/api/analytics/subjects/{self.maths.pk}/students/{self.zawadi.pk}/").status_code, 404)

    def test_question_analysis(self):
        exam, _ = self.make_exam(self.maths, picks={self.amina: ["b", "a"]})
        d = self.client_for(self.teacher).get(f"/api/analytics/exams/{exam.pk}/questions/").json()
        q1, q2 = d["questions"]
        self.assertEqual((q1["percent_correct"], q2["percent_correct"]), (100.0, 0.0))
        self.assertEqual(q2["most_chosen_wrong"]["text"], "3")

    def test_heatmap(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"], self.zawadi: ["b", "a"]})
        d = self.client_for(self.admin).get(f"/api/analytics/subjects/{self.maths.pk}/heatmap/").json()
        self.assertEqual(d["topics"], ["Algebra"])
        self.assertEqual(d["cells"], [[100.0, 50.0]])

    def test_teacher_cannot_use_admin_endpoints(self):
        c = self.client_for(self.teacher)
        self.assertEqual(c.get("/api/analytics/school/").status_code, 403)
        self.assertEqual(c.get("/api/exports/students/").status_code, 403)

    def test_school_analytics_and_participation(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"]})  # zawadi never sat it
        d = self.client_for(self.admin).get("/api/analytics/school/").json()
        self.assertEqual(d["participation"]["overall_rate"], 50.0)
        self.assertTrue(d["engagement"]["available"])  # Phase 3: engagement numbers exist now


class DownloadTests(AnalyticsBase):
    def test_subject_export_xlsx_and_pdf(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"]})
        c = self.client_for(self.teacher)
        r = c.get(f"/api/analytics/subjects/{self.maths.pk}/export/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("spreadsheetml", r["Content-Type"])
        r = c.get(f"/api/analytics/subjects/{self.maths.pk}/export/?file=pdf")
        self.assertTrue(r.content.startswith(b"%PDF"))
        self.assertEqual(c.get(f"/api/analytics/subjects/{self.english.pk}/export/").status_code, 404)

    def test_result_slip_is_private(self):
        _, attempts = self.make_exam(self.maths, picks={self.amina: ["b", "b"]})
        a = attempts[self.amina.pk]
        r = self.client_for(self.amina).get(f"/api/results/{a.pk}/slip/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content.startswith(b"%PDF"))
        self.assertEqual(self.client_for(self.zawadi).get(f"/api/results/{a.pk}/slip/").status_code, 404)
        self.assertEqual(self.client_for(self.admin).get(f"/api/exports/slip/{a.pk}/").status_code, 200)

    def test_slip_hidden_before_publish(self):
        exam, attempts = self.make_exam(self.maths, picks={self.amina: ["b", "b"]}, publish=False)
        Exam.objects.filter(pk=exam.pk).update(end_at=timezone.now())  # ended just now: inside the 5 minutes
        a = attempts[self.amina.pk]
        self.assertEqual(self.client_for(self.amina).get(f"/api/results/{a.pk}/slip/").status_code, 404)

    def test_admin_exports(self):
        exam, _ = self.make_exam(self.maths, picks={self.amina: ["b", "b"]})
        c = self.client_for(self.admin)
        self.assertEqual(c.get(f"/api/exports/exams/{exam.pk}/results/").status_code, 200)
        self.assertTrue(c.get("/api/exports/students/?file=pdf").content.startswith(b"%PDF"))


class StudentAnalyticsTests(AnalyticsBase):
    def test_student_sees_only_own_analytics_and_projection(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "a"], self.zawadi: ["b", "b"]})
        d = self.client_for(self.amina).get("/api/student/analytics/").json()
        self.assertEqual(d["subjects"][0]["average"], 50.0)
        self.assertEqual(d["subjects"][0]["subject"], "Mathematics")
        self.assertTrue(d["projected"]["is_projection"])
        self.assertIsNone(d["projected"]["division"])  # only one subject so far
        self.assertEqual(self.client_for(self.admin).get("/api/student/analytics/").status_code, 403)

    def test_report_card_marked_projection_without_term(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"]})
        d = self.client_for(self.amina).get("/api/student/report-card/").json()
        self.assertTrue(d["is_projection"])
        self.assertEqual(d["subjects_needed"], 7)


class LoginActivityTests(AnalyticsBase):
    """Login activity (admin only) is built from the audit log's "login" entries."""

    def setUp(self):
        super().setUp()
        from core.models import AuditLog
        self.AuditLog = AuditLog
        self.a = self.client_for(self.admin)
        self.today = timezone.now().astimezone(__import__("zoneinfo").ZoneInfo("Africa/Dar_es_Salaam")).replace(hour=10, minute=0, second=0, microsecond=0)

    def login_at(self, user, days_ago, hour=10, n=1):
        for _ in range(n):
            row = self.AuditLog.objects.create(actor=user, action="login", target=str(user.pk))
            self.AuditLog.objects.filter(pk=row.pk).update(created_at=(self.today - timedelta(days=days_ago)).replace(hour=hour))

    def test_only_admins_can_see_it(self):
        for who in (self.teacher, self.amina):
            c = self.client_for(who)
            for url in ("/api/analytics/logins/", "/api/analytics/logins/students/", f"/api/analytics/logins/students/{self.amina.pk}/"):
                self.assertIn(c.get(url).status_code, (401, 403), url)

    def test_overview_counts_days_students_hours_and_bands(self):
        self.login_at(self.amina, 0, hour=8, n=2)   # two logins today count as ONE active day, TWO logins
        self.login_at(self.amina, 3, hour=8)
        self.login_at(self.zawadi, 1, hour=15)
        self.AuditLog.objects.create(actor=self.teacher, action="login")  # staff logins are not student activity
        d = self.a.get("/api/analytics/logins/?days=7").json()
        self.assertEqual((d["students"], d["active_students"], d["never"], d["logins"]), (2, 2, 0, 4))
        self.assertEqual(len(d["daily"]), 7)
        self.assertEqual((d["daily"][-1]["logins"], d["daily"][-1]["students"]), (2, 1))
        self.assertEqual((d["hours"][8], d["hours"][15], sum(d["hours"])), (3, 1, 4))
        self.assertEqual(sum(d["weekdays"]), 4)
        bands = {b["label"]: b["count"] for b in d["bands"]}
        self.assertEqual((bands["Never"], bands["1 day"], bands["2 to 3 days"]), (0, 1, 1))  # Zawadi 1 day, Amina 2 days

    def test_wrong_password_tries_are_counted_for_admins(self):
        for _ in range(3):
            row = self.AuditLog.objects.create(actor=self.amina, action="login.failed", target=str(self.amina.pk))
        self.login_at(self.zawadi, 0)
        d = self.a.get("/api/analytics/logins/?days=7").json()
        self.assertEqual((d["failed_logins"], d["students_with_failed"], d["daily"][-1]["failed"]), (3, 1, 3))
        rows = {r["name"]: r for r in self.a.get("/api/analytics/logins/students/").json()}
        self.assertEqual((rows["Amina Test"]["failed"], rows["Zawadi Test"]["failed"]), (3, 0))
        top = self.a.get("/api/analytics/logins/students/?sort=failed").json()
        self.assertEqual(top[0]["name"], "Amina Test")
        self.assertEqual(self.a.get(f"/api/analytics/logins/students/{self.amina.pk}/").json()["failed"], 3)

    def test_old_logins_fall_outside_the_period_and_a_student_with_none_is_listed_as_never(self):
        self.login_at(self.amina, 40)
        d = self.a.get("/api/analytics/logins/?days=30").json()
        self.assertEqual((d["active_students"], d["never"], d["logins"]), (0, 2, 0))
        self.assertEqual(self.a.get("/api/analytics/logins/?days=90").json()["active_students"], 1)

    def test_class_filter_and_bad_input(self):
        self.login_at(self.amina, 0)
        self.login_at(self.zawadi, 0)
        d = self.a.get(f"/api/analytics/logins/?class={self.cls_a.pk}").json()
        self.assertEqual((d["students"], d["logins"]), (1, 1))
        for q in ("days=0", "days=999", "days=abc", "class=x"):
            self.assertEqual(self.a.get("/api/analytics/logins/?" + q).status_code, 400, q)

    def test_student_list_sorts_searches_and_pages(self):
        self.login_at(self.amina, 0)
        self.login_at(self.amina, 2)
        self.login_at(self.zawadi, 5)
        rows = self.a.get("/api/analytics/logins/students/?days=30").json()
        self.assertEqual([r["name"] for r in rows], ["Zawadi Test", "Amina Test"])  # least active first
        self.assertEqual((rows[1]["active_days"], rows[1]["logins"], rows[1]["days_since"]), (2, 2, 0))
        self.assertEqual(rows[0]["days_since"], 5)
        self.assertEqual(self.a.get("/api/analytics/logins/students/?sort=most").json()[0]["name"], "Amina Test")
        self.assertEqual(self.a.get("/api/analytics/logins/students/?sort=recent").json()[0]["name"], "Amina Test")
        self.assertEqual(len(self.a.get("/api/analytics/logins/students/?q=zaw").json()), 1)
        self.assertEqual(self.a.get("/api/analytics/logins/students/?sort=nope").status_code, 400)
        p = self.a.get("/api/analytics/logins/students/?page=1&page_size=1").json()
        self.assertEqual((p["count"], len(p["results"])), (2, 1))

    def test_a_student_who_never_logged_in_has_no_last_login(self):
        rows = {r["name"]: r for r in self.a.get("/api/analytics/logins/students/").json()}
        self.assertEqual((rows["Amina Test"]["active_days"], rows["Amina Test"]["last_login"], rows["Amina Test"]["days_since"]), (0, None, None))

    def test_one_student_history_and_longest_break(self):
        self.login_at(self.amina, 0, hour=7)
        self.login_at(self.amina, 6, hour=7)
        self.login_at(self.amina, 20)  # before the 10 day window, but it is her last login before that
        d = self.a.get(f"/api/analytics/logins/students/{self.amina.pk}/?days=10").json()
        self.assertEqual((len(d["daily"]), d["active_days"], d["logins"], d["longest_gap_days"]), (10, 2, 2, 5))  # days 5..1 ago are empty
        self.assertEqual((d["daily"][-1]["logins"], d["hours"][7], d["days_since"]), (1, 2, 0))
        self.assertEqual(self.a.get(f"/api/analytics/logins/students/{self.teacher.pk}/").status_code, 404)  # students only
