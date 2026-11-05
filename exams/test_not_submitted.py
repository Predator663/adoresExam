"""Admin 'Not submitted' panel, plus the new search on teachers, admins and the audit log.
Run:  python manage.py test exams.test_not_submitted"""
import io
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from openpyxl import load_workbook

from academics.models import SchoolClass, TeacherAssignment
from accounts.models import User
from analytics.tests import AnalyticsBase
from core.models import AuditLog
from exams import services
from exams.models import Exam, ExamQuestion
from exams.tests import mcq
from guardians.models import Guardian, GuardianLink

URL = "/api/exams/not-submitted/"


class NotSubmittedTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        mk = lambda name, cls, idx: User.objects.create(username=name, first_name=name.title(), last_name="Test", role="student",
                                                        school_class=cls, index_number=idx, password=make_password("pw-" + name + "-1"))
        self.mary = mk("mary", self.cls_a, "S3")      # will start but never submit
        self.juma = mk("juma", self.cls_b, "S4")      # never opens the exam
        # amina submits, mary starts and is auto-submitted when the time runs out, zawadi and juma never sit
        self.exam, _ = self.make_exam(self.maths, "Maths test", picks={self.amina: ["b", "b"]}, publish=False)
        services.start_attempt(self.exam, self.mary, now=self.start + timedelta(minutes=2))
        a = self.exam.attempts.get(student=self.amina)
        services.finalize_attempt(a.pk, self.start + timedelta(minutes=10)) if a.status == "in_progress" else None
        services.sync_exam(self.exam)
        self.c = self.client_for(self.admin)

    def live_exam(self):
        now = timezone.now()
        exam = Exam.objects.create(title="Live one", subject=self.english, start_at=now - timedelta(minutes=10), end_at=now + timedelta(hours=1),
                                   duration_minutes=60, status=Exam.LIVE, shuffle_questions=False)
        exam.classes.add(self.cls_a, self.cls_b)
        ExamQuestion.objects.create(exam=exam, position=1, payload=mcq())
        services.start_attempt(exam, self.mary, now=now - timedelta(minutes=5))
        return exam

    def names(self, qs=""):
        d = self.c.get(f"{URL}?exam={self.exam.pk}{qs}").json()
        return d, [r["name"] for r in d["rows"]]

    def test_default_lists_those_who_never_sat(self):
        d, names = self.names()
        self.assertEqual(sorted(names), ["Juma Test", "Zawadi Test"])
        self.assertEqual(d["summary"]["eligible"], 4)
        self.assertEqual(d["summary"]["none"], 2)
        self.assertEqual(d["summary"]["submitted"], 2)          # amina, and mary (auto-submitted)
        self.assertEqual(d["summary"]["pct_submitted"], 50.0)
        self.assertEqual({r["status"] for r in d["rows"]}, {"none"})

    def test_auto_submitted_can_be_added_and_a_live_exam_shows_who_is_writing(self):
        _, names = self.names("&status=none,auto")
        self.assertIn("Mary Test", names)
        live = self.live_exam()
        d = self.c.get(f"{URL}?exam={live.pk}&status=none,writing").json()
        by = {r["name"]: r["status"] for r in d["rows"]}
        self.assertEqual(by["Mary Test"], "writing")
        self.assertEqual(by["Amina Test"], "none")
        self.assertEqual(d["summary"]["writing"], 1)

    def test_search_class_and_sort(self):
        _, names = self.names("&q=zaw")
        self.assertEqual(names, ["Zawadi Test"])
        _, names = self.names("&q=s4")                        # by index number
        self.assertEqual(names, ["Juma Test"])
        _, names = self.names("&q=test juma")                 # every word must match
        self.assertEqual(names, ["Juma Test"])
        _, names = self.names(f"&class={self.cls_b.pk}")
        self.assertEqual(sorted(names), ["Juma Test", "Zawadi Test"])
        _, names = self.names("&sort=name&dir=desc")
        self.assertEqual(names, ["Zawadi Test", "Juma Test"])
        _, names = self.names("&q=nobody")
        self.assertEqual(names, [])

    def test_class_breakdown_always_lists_every_class(self):
        d, _ = self.names(f"&class={self.cls_b.pk}")
        self.assertEqual([c["class"] for c in d["classes"]], ["Form 1 A", "Form 1 B"])
        self.assertEqual({c["class"]: c["not_submitted"] for c in d["classes"]}, {"Form 1 A": 0, "Form 1 B": 2})
        self.assertEqual(d["summary"]["eligible"], 2)          # the tiles follow the class filter

    def test_only_administrators(self):
        for who in (self.teacher, self.amina):
            c = self.client_for(who)
            for path in (URL + "options/", f"{URL}?exam={self.exam.pk}", f"{URL}export/?exam={self.exam.pk}"):
                self.assertEqual(c.get(path).status_code, 403, path)

    def test_bad_requests_are_refused_in_plain_words(self):
        for q in ("", "exam=abc", "exam=99999", f"exam={self.exam.pk}&status=wrong", f"exam={self.exam.pk}&sort=nope",
                  f"exam={self.exam.pk}&dir=up", f"exam={self.exam.pk}&class=x"):
            r = self.c.get(f"{URL}?{q}")
            self.assertIn(r.status_code, (400, 404), q)
        draft = Exam.objects.create(title="Draft", subject=self.maths, status=Exam.DRAFT)
        self.assertEqual(self.c.get(f"{URL}?exam={draft.pk}").status_code, 400)

    def test_options_list_only_exams_that_have_started(self):
        Exam.objects.create(title="Future", subject=self.maths, start_at=timezone.now() + timedelta(days=3), end_at=timezone.now() + timedelta(days=3, hours=1),
                            duration_minutes=60, status=Exam.SCHEDULED)
        d = self.c.get(URL + "options/").json()
        self.assertEqual([e["title"] for e in d["exams"]], ["Maths test"])
        self.assertEqual(len(d["classes"]), 2)

    def test_parent_numbers_only_when_asked_and_always_audited(self):
        g = Guardian(relationship="Mother"); g.set_name("Neema Test"); g.set_phone("+255712345678"); g.save()
        GuardianLink.objects.create(guardian=g, student=self.zawadi)
        d, _ = self.names()
        self.assertTrue(all(r["parents"] == [] for r in d["rows"]))
        self.assertFalse(AuditLog.objects.filter(action="export.not_submitted_parents").exists())
        d, _ = self.names("&parents=1")
        z = next(r for r in d["rows"] if r["name"] == "Zawadi Test")
        self.assertEqual(z["parents"], [{"name": "Neema Test", "phone": "+255712345678", "relationship": "Mother"}])
        entry = AuditLog.objects.get(action="export.not_submitted_parents")
        self.assertEqual((entry.detail["via"], entry.detail["students"]), ("screen", 2))

    def test_pdf_and_excel(self):
        g = Guardian(relationship="Father"); g.set_name("Baba Juma"); g.set_phone("+255700111222"); g.save()
        GuardianLink.objects.create(guardian=g, student=self.juma)
        pdf = self.c.get(f"{URL}export/?exam={self.exam.pk}&file=pdf&parents=1")
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        xl = self.c.get(f"{URL}export/?exam={self.exam.pk}&file=xlsx&parents=1&status=none,auto")
        ws = load_workbook(io.BytesIO(xl.content)).active
        flat = [str(c.value) for row in ws.iter_rows() for c in row if c.value is not None]
        self.assertIn("Juma Test", flat)
        self.assertTrue(any("+255700111222" in x for x in flat))
        self.assertTrue(AuditLog.objects.filter(action="export.not_submitted").exists())
        empty = self.c.get(f"{URL}export/?exam={self.exam.pk}&file=pdf&q=nobody")
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(self.c.get(f"{URL}export/?exam={self.exam.pk}&file=exe").status_code, 400)


class SearchTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        mk = lambda u, f, l, role, **kw: User.objects.create(username=u, first_name=f, last_name=l, role=role, password=make_password("Pw-" + u + "-1!"), **kw)
        self.mary = mk("mary.k", "Mary", "Kimaro", "teacher", email="mary@school.tz")
        self.joyce = mk("joyce", "Joyce", "Mushi", "teacher", is_active=False)
        TeacherAssignment.objects.create(teacher=self.mary, subject=self.english, school_class=None)
        self.root = mk("root", "Root", "Owner", "super_admin")
        self.c = self.client_for(self.admin)

    def usernames(self, path):
        d = self.c.get(path).json()
        return sorted(r["username"] for r in (d["results"] if isinstance(d, dict) else d))

    def test_teacher_search_by_name_username_email_and_several_words(self):
        for q in ("mary", "kimaro", "mary@school", "mary k", "MARY"):
            self.assertEqual(self.usernames(f"/api/teachers/?q={q}"), ["mary.k"], q)
        self.assertEqual(self.usernames("/api/teachers/?q=zzz"), [])

    def test_teacher_filters_status_subject_class(self):
        self.assertEqual(self.usernames("/api/teachers/?active=0"), ["joyce"])
        self.assertEqual(self.usernames("/api/teachers/?active=1"), ["mary.k", "teach"])
        self.assertEqual(self.usernames(f"/api/teachers/?subject={self.maths.pk}"), ["teach"])
        self.assertEqual(self.usernames(f"/api/teachers/?class={self.cls_a.pk}"), ["mary.k", "teach"])   # mary teaches every class
        self.assertEqual(self.usernames(f"/api/teachers/?class={self.cls_b.pk}"), ["mary.k"])
        self.assertEqual(self.usernames(f"/api/teachers/?subject={self.english.pk}&class={self.cls_a.pk}"), ["mary.k"])

    def test_admin_accounts_search_for_super_admin(self):
        c = self.client_for(self.root)
        d = c.get("/api/admins/?q=admin1").json()
        self.assertEqual([r["username"] for r in (d["results"] if isinstance(d, dict) else d)], ["admin1"])

    def test_audit_log_free_text(self):
        from core.models import audit
        audit(self.admin, "exam.create", 7, title="Form 2 Geography")
        audit(self.root, "password.reset", 9)
        d = self.c.get("/api/audit-log/?q=geography").json()
        self.assertEqual([r["action"] for r in d["results"]], ["exam.create"])
        d = self.c.get("/api/audit-log/?q=root reset").json()
        self.assertEqual([r["action"] for r in d["results"]], ["password.reset"])
        self.assertEqual(self.c.get("/api/audit-log/?q=nothing-like-this").json()["count"], 0)
