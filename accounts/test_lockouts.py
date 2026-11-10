"""Locked-accounts tests (Super Admin only). Run:  python manage.py test accounts.test_lockouts"""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts import temp_password
from accounts.models import User
from analytics.tests import AnalyticsBase
from core.models import AuditLog


class LockoutTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        self.boss = User.objects.create(username="boss", role="super_admin", password=make_password("Sup3r-pass-1"))
        self.s = self.client_for(self.boss)

    def lock(self, u, minutes=10):
        u.locked_until, u.failed_logins = timezone.now() + timedelta(minutes=minutes), 0
        u.save(update_fields=["locked_until", "failed_logins"])

    def ids(self, r):
        return [x["id"] for x in r.json()["results"]]

    # ---- who may use it
    def test_only_super_admin(self):
        for who in (self.teacher, self.admin, self.amina):
            c = self.client_for(who)
            self.assertEqual(c.get("/api/lockouts/").status_code, 403, who.role)
            self.assertEqual(c.post(f"/api/lockouts/{self.amina.pk}/reset-attempts/").status_code, 403, who.role)
            self.assertEqual(c.post(f"/api/lockouts/{self.amina.pk}/reset-password/").status_code, 403, who.role)
            self.assertEqual(c.post("/api/lockouts/bulk/", {"ids": [self.amina.pk], "action": "reset_attempts"}, format="json").status_code, 403, who.role)
        self.assertEqual(APIClient().get("/api/lockouts/").status_code, 401)

    # ---- the list
    def test_list_shows_locked_by_default_with_summary(self):
        self.lock(self.amina)
        self.zawadi.failed_logins = 3
        self.zawadi.save(update_fields=["failed_logins"])
        r = self.s.get("/api/lockouts/").json()
        self.assertEqual([x["username"] for x in r["results"]], ["amina"])
        self.assertEqual((r["summary"]["locked"], r["summary"]["warning"]), (1, 1))
        self.assertEqual((r["summary"]["max_attempts"], r["summary"]["lock_minutes"]), (5, 15))
        row = r["results"][0]
        self.assertTrue(row["locked"])
        self.assertTrue(595 <= row["seconds_left"] <= 600)
        self.assertEqual(row["class_name"], "Form 1 A")
        self.assertIn("server_time", r)
        w = self.s.get("/api/lockouts/?status=warning").json()["results"]
        self.assertEqual([(x["username"], x["failed_logins"], x["attempts_left"], x["locked"]) for x in w], [("zawadi", 3, 2, False)])
        self.assertEqual(sorted(self.ids(self.s.get("/api/lockouts/?status=all"))), sorted([self.amina.pk, self.zawadi.pk]))

    def test_expired_lock_is_not_listed_and_bad_status_is_refused(self):
        self.lock(self.amina, minutes=-5)
        self.assertEqual(self.ids(self.s.get("/api/lockouts/?status=all")), [])
        self.assertEqual(self.s.get("/api/lockouts/?status=nope").status_code, 400)

    def test_search_class_archived_staff_and_paging(self):
        self.lock(self.amina)
        self.lock(self.zawadi)
        self.assertEqual(self.ids(self.s.get("/api/lockouts/?q=zaw")), [self.zawadi.pk])
        self.assertEqual(self.ids(self.s.get("/api/lockouts/?q=S1")), [self.amina.pk])  # index number
        self.assertEqual(self.ids(self.s.get(f"/api/lockouts/?class={self.cls_b.pk}")), [self.zawadi.pk])
        self.lock(self.teacher)  # staff are not students: not in the default (student) list
        self.assertEqual(len(self.ids(self.s.get("/api/lockouts/"))), 2)
        p = self.s.get("/api/lockouts/?page=1&page_size=1").json()
        self.assertEqual((p["count"], p["pages"], len(p["results"])), (2, 2, 1))
        self.assertEqual(self.s.get("/api/lockouts/?page=99&page_size=1").json()["page"], 2)  # past the end -> last page
        self.amina.is_archived = True
        self.amina.save(update_fields=["is_archived"])
        self.assertEqual(self.ids(self.s.get("/api/lockouts/")), [self.zawadi.pk])
        self.assertEqual(self.s.get("/api/lockouts/").json()["summary"]["locked"], 1)

    # ---- the real flow through the login screen: wrong passwords no longer lock anybody, they are only counted
    def test_wrong_passwords_never_lock_and_are_counted(self):
        c = APIClient()
        for _ in range(8):
            self.assertEqual(c.post("/api/auth/login/", {"username": "amina", "password": "bad"}).status_code, 400)
        self.assertEqual(c.post("/api/auth/login/", {"username": "amina", "password": "pw-amina-1"}).status_code, 200)  # right password still works
        self.assertEqual(AuditLog.objects.filter(action="login.failed", actor=self.amina).count(), 8)
        self.amina.refresh_from_db()
        self.assertEqual((self.amina.failed_logins, self.amina.locked_until), (0, None))  # a good login resets the run
        self.assertEqual(self.ids(self.s.get("/api/lockouts/")), [])

    def test_old_lock_is_not_enforced_and_clears_on_login(self):
        self.lock(self.amina)
        self.assertEqual(APIClient().post("/api/auth/login/", {"username": "amina", "password": "pw-amina-1"}).status_code, 200)
        self.amina.refresh_from_db()
        self.assertIsNone(self.amina.locked_until)

    def test_reset_teacher_password_is_strong_random_and_unlocks(self):
        self.lock(self.teacher)
        tok = Token.objects.create(user=self.teacher)
        r = self.s.post(f"/api/lockouts/{self.teacher.pk}/reset-password/").json()
        code = r["temporary_password"]
        self.assertGreaterEqual(len(code), 10)
        self.teacher.refresh_from_db()
        self.assertTrue(self.teacher.check_password(code))
        self.assertTrue(self.teacher.must_change_password)
        self.assertIsNone(self.teacher.locked_until)
        self.assertEqual(self.teacher.failed_logins, 0)
        self.assertFalse(Token.objects.filter(key=tok.key).exists())
        self.assertEqual(APIClient().post("/api/auth/login/", {"username": "teach", "password": code}).status_code, 200)
        self.assertEqual(AuditLog.objects.get(action="password.reset").detail["role"], "teacher")

    def test_bulk_unlock_mixed_roles_but_passwords_students_only(self):
        self.lock(self.teacher)
        self.lock(self.amina)
        r = self.s.post("/api/lockouts/bulk/", {"ids": [self.teacher.pk, self.amina.pk, self.boss.pk], "action": "reset_attempts", "role": "teacher"}, format="json").json()
        self.assertEqual((r["affected"], r["skipped"]), (2, 1))  # your own account is skipped
        self.lock(self.teacher)
        bad = self.s.post("/api/lockouts/bulk/", {"ids": [self.teacher.pk, self.amina.pk], "action": "reset_passwords"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.teacher.refresh_from_db()
        self.assertIsNotNone(self.teacher.locked_until)  # refused before anything changed
        self.assertEqual(self.s.post("/api/lockouts/bulk/", {"ids": [self.amina.pk], "action": "reset_attempts", "role": "nope"}, format="json").status_code, 400)

    # ---- new password
    def test_reset_password_gives_new_code_unlocks_and_logs_her_out(self):
        self.lock(self.amina)
        tok = Token.objects.create(user=self.amina)
        r = self.s.post(f"/api/lockouts/{self.amina.pk}/reset-password/")
        self.assertEqual(r.status_code, 200)
        code = r.json()["temporary_password"]
        self.amina.refresh_from_db()
        self.assertEqual(code, temp_password.password_for(self.amina))  # the same code the credentials sheet prints
        self.assertTrue(self.amina.check_password(code))
        self.assertTrue(self.amina.must_change_password)
        self.assertIsNone(self.amina.locked_until)
        self.assertEqual(self.amina.failed_logins, 0)
        self.assertFalse(Token.objects.filter(key=tok.key).exists())
        self.assertEqual(APIClient().post("/api/auth/login/", {"username": "amina", "password": code}).status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="password.reset", actor=self.boss, target=str(self.amina.pk)).exists())

    def test_reset_password_survives_a_failing_notification(self):
        from unittest import mock
        with mock.patch("accounts.lockouts.notify_password_changed", side_effect=RuntimeError("push down")):
            with self.assertLogs("accounts.lockouts", level="ERROR"):
                r = self.s.post(f"/api/lockouts/{self.amina.pk}/reset-password/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["temporary_password"])

    # ---- many at once
    def test_bulk_reset_attempts(self):
        self.lock(self.amina)
        self.zawadi.failed_logins = 2
        self.zawadi.save(update_fields=["failed_logins"])
        other = User.objects.create(username="boss2", role="super_admin", password=make_password("Sup3r-pass-2"))
        self.lock(other)
        ids = [self.amina.pk, self.zawadi.pk, other.pk, 999999]  # another Super Admin and an unknown id are skipped, not touched
        r = self.s.post("/api/lockouts/bulk/", {"ids": ids, "action": "reset_attempts"}, format="json").json()
        self.assertEqual((r["affected"], r["skipped"], r["requested"]), (2, 2, 4))
        self.assertEqual((r["summary"]["locked"], r["summary"]["warning"]), (0, 0))
        other.refresh_from_db()
        self.assertIsNotNone(other.locked_until)
        log = AuditLog.objects.get(action="login.unlock.bulk")
        self.assertEqual(sorted(log.detail["usernames"]), ["amina", "zawadi"])

    def test_bulk_reset_passwords_returns_codes_once(self):
        self.lock(self.amina)
        r = self.s.post("/api/lockouts/bulk/", {"ids": [self.amina.pk, self.zawadi.pk], "action": "reset_passwords"}, format="json").json()
        self.assertEqual(r["affected"], 2)
        by = {c["username"]: c for c in r["credentials"]}
        for u in (self.amina, self.zawadi):
            u.refresh_from_db()
            self.assertEqual(by[u.username]["temporary_password"], temp_password.password_for(u))
            self.assertTrue(u.check_password(by[u.username]["temporary_password"]))
            self.assertTrue(u.must_change_password)
        self.assertEqual(by["amina"]["class_name"], "Form 1 A")
        self.assertIsNone(self.amina.locked_until)

    def test_bulk_validation(self):
        post = lambda body: self.s.post("/api/lockouts/bulk/", body, format="json").status_code
        self.assertEqual(post({"ids": [], "action": "reset_attempts"}), 400)
        self.assertEqual(post({"ids": "1", "action": "reset_attempts"}), 400)
        self.assertEqual(post({"ids": ["x"], "action": "reset_attempts"}), 400)
        self.assertEqual(post({"ids": [self.amina.pk], "action": "delete_everything"}), 400)
        self.assertEqual(post({"ids": list(range(1, 202)), "action": "reset_attempts"}), 400)
        self.assertEqual(post({"ids": [self.amina.pk, self.amina.pk], "action": "reset_attempts"}), 200)  # duplicates are fine
