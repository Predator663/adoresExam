"""Choosing a new password after a reset: students follow the normal rule, teachers and admins the strong staff rule."""
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import User
from . import temp_password


class ChangePasswordRuleTests(TestCase):
    def client_for(self, user):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")
        return c

    def test_teacher_cannot_pick_a_weak_password(self):
        t = User.objects.create(username="t1", role="teacher", must_change_password=True)
        t.set_password("Start-Pass-9x"); t.save()
        r = self.client_for(t).post("/api/auth/change-password/", {"old_password": "Start-Pass-9x", "new_password": "abcdefgh"}, format="json")
        self.assertEqual(r.status_code, 400)
        t.refresh_from_db(); self.assertTrue(t.must_change_password)

    def test_teacher_can_pick_a_strong_password(self):
        t = User.objects.create(username="t2", role="teacher", must_change_password=True)
        t.set_password("Start-Pass-9x"); t.save()
        r = self.client_for(t).post("/api/auth/change-password/", {"old_password": "Start-Pass-9x", "new_password": "Tz-Secure-2026"}, format="json")
        self.assertEqual(r.status_code, 200)
        t.refresh_from_db(); self.assertFalse(t.must_change_password)

    def test_student_keeps_the_simpler_rule(self):
        s = User.objects.create(username="s9", role="student")
        code = temp_password.issue(s)
        r = self.client_for(s).post("/api/auth/change-password/", {"old_password": code, "new_password": "mango-tree-77"}, format="json")
        self.assertEqual(r.status_code, 200)
