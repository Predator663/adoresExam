"""Security fixes from the audit.  python manage.py test accounts.test_security"""
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts import temp_password
from accounts.models import User
from analytics.tests import AnalyticsBase


class SecurityTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def login(self, username, password):
        return APIClient().post("/api/auth/login/", {"username": username, "password": password}, format="json")

    def test_starting_password_is_not_the_index_number(self):
        code = temp_password.issue(self.amina)
        self.assertEqual(len(code), 8)
        self.assertNotEqual(code, self.amina.index_number)
        self.assertEqual(self.login(self.amina.username, self.amina.index_number).status_code, 400)
        self.assertEqual(self.login(self.amina.username, code).status_code, 200)

    def test_new_code_replaces_the_old_one(self):
        old = temp_password.issue(self.amina)
        new = temp_password.issue(self.amina)
        self.assertNotEqual(old, new)
        self.assertEqual(self.login(self.amina.username, old).status_code, 400)
        self.assertEqual(self.login(self.amina.username, new).status_code, 200)

    def test_unused_starting_password_expires(self):
        code = temp_password.issue(self.amina)
        User.objects.filter(pk=self.amina.pk).update(temp_issued_at=timezone.now() - timedelta(days=30))
        r = self.login(self.amina.username, code)
        self.assertEqual(r.status_code, 400)
        self.assertIn("expired", r.json()["detail"])

    def test_token_expires(self):
        tok = Token.objects.get_or_create(user=self.amina)[0]
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Token " + tok.key)
        self.assertEqual(c.get("/api/me/").status_code, 200)
        Token.objects.filter(pk=tok.pk).update(created=timezone.now() - timedelta(hours=13))
        self.assertEqual(c.get("/api/me/").status_code, 401)

    def test_unknown_names_lock_like_real_ones(self):
        codes = [self.login("no-such-girl", "x").status_code for _ in range(7)]
        self.assertEqual(codes[0], 400)
        self.assertEqual(codes[-1], 429)  # the same lock-out a real name gets: names cannot be told apart

    def test_sanitiser_drops_foreign_images(self):
        from core.sanitize import clean_html
        self.assertNotIn("evil.example", clean_html('<img src="https://evil.example/x.png" alt="a">'))
        self.assertIn("/media/question_images/a.webp", clean_html('<img src="/media/question_images/a.webp" alt="a">'))

    def test_security_headers(self):
        r = APIClient().get("/api/site-status/")
        self.assertEqual(r.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertIn("default-src 'none'", r.headers.get("Content-Security-Policy", ""))


class UnlockTests(AnalyticsBase):
    """An admin lifts a lock-out without changing the password."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def lock(self, user):
        c = APIClient()
        for _ in range(5):
            c.post("/api/auth/login/", {"username": user.username, "password": "wrong"}, format="json")

    def login(self, username, password):
        return APIClient().post("/api/auth/login/", {"username": username, "password": password}, format="json")

    def test_five_wrong_passwords_lock_the_account(self):
        self.lock(self.amina)
        self.assertEqual(self.login("amina", "pw-amina-1").status_code, 429)  # even the right password is refused

    def test_unlock_keeps_the_password_and_lets_her_in(self):
        self.lock(self.amina)
        r = self.client_for(self.admin).post(f"/api/students/{self.amina.pk}/unlock/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.amina.refresh_from_db()
        self.assertIsNone(self.amina.locked_until)
        self.assertEqual(self.amina.failed_logins, 0)
        self.assertEqual(self.login("amina", "pw-amina-1").status_code, 200)  # same password still works

    def test_list_shows_who_is_locked(self):
        self.lock(self.amina)
        rows = self.client_for(self.admin).get("/api/students/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        by = {r["username"]: r for r in rows}
        self.assertTrue(by["amina"]["is_locked"])
        self.assertFalse(by["zawadi"]["is_locked"])

    def test_bulk_unlock(self):
        self.lock(self.amina)
        self.lock(self.zawadi)
        r = self.client_for(self.admin).post("/api/students/bulk-action/",
                                             {"action": "unlock", "ids": [self.amina.pk, self.zawadi.pk]}, format="json")
        self.assertEqual(r.json()["affected"], 2)
        self.assertEqual(User.objects.filter(locked_until__isnull=False).count(), 0)

    def test_teacher_and_student_cannot_unlock(self):
        self.lock(self.amina)
        self.assertEqual(self.client_for(self.teacher).post(f"/api/students/{self.amina.pk}/unlock/", {}, format="json").status_code, 403)
        self.assertEqual(self.client_for(self.zawadi).post(f"/api/students/{self.amina.pk}/unlock/", {}, format="json").status_code, 403)

    def test_admin_can_unlock_a_teacher(self):
        self.lock(self.teacher)
        r = self.client_for(self.admin).post(f"/api/teachers/{self.teacher.pk}/unlock/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.login("teach", "Teach-pass-1").status_code, 200)
