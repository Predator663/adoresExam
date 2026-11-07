"""Login limits: per user name and per address.  python manage.py test accounts.test_login_throttle"""
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from analytics.tests import AnalyticsBase


class LoginThrottleTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def login(self, username, password):
        return APIClient().post("/api/auth/login/", {"username": username, "password": password}, format="json")

    @override_settings(LOGIN_IP_THROTTLE_RATE="600/min", LOGIN_USER_THROTTLE_RATE="10/min")
    def test_a_whole_class_on_one_address_can_log_in_together(self):
        for i in range(60):  # the old limit of 20 per address per minute stopped everybody after the first 20
            User.objects.create(username=f"girl{i}", role="student", school_class=self.cls_a, password=make_password("pw-girl-1"))
        codes = [self.login(f"girl{i}", "pw-girl-1").status_code for i in range(60)]
        self.assertEqual(set(codes), {200})

    @override_settings(LOGIN_IP_THROTTLE_RATE="600/min", LOGIN_USER_THROTTLE_RATE="3/min")
    def test_one_name_is_limited_but_others_are_not(self):
        self.assertEqual([self.login("amina", "pw-amina-1").status_code for _ in range(3)], [200, 200, 200])
        r = self.login("amina", "pw-amina-1")
        self.assertEqual(r.status_code, 429)
        self.assertIn("throttled", r.json()["detail"].lower())
        self.assertEqual(self.login("zawadi", "pw-zawadi-1").status_code, 200)  # same address, another name

    @override_settings(LOGIN_IP_THROTTLE_RATE="600/min", LOGIN_USER_THROTTLE_RATE="2/min")
    def test_capital_letters_do_not_dodge_it(self):
        self.assertEqual([self.login(n, "pw-amina-1").status_code for n in ("amina", "AMINA")], [200, 200])
        self.assertEqual(self.login("Amina", "pw-amina-1").status_code, 429)

    @override_settings(LOGIN_IP_THROTTLE_RATE="600/min", LOGIN_USER_THROTTLE_RATE="3/min")
    def test_names_that_do_not_exist_are_limited_the_same_way(self):
        codes = [self.login("nobody-here", "x").status_code for _ in range(4)]
        self.assertEqual(codes, [400, 400, 400, 429])  # same answers a real name gets: names cannot be told apart

    @override_settings(LOGIN_IP_THROTTLE_RATE="5/min", LOGIN_USER_THROTTLE_RATE="1000/min")
    def test_the_address_limit_still_stops_a_flood(self):
        codes = [self.login(f"nobody{i}", "x").status_code for i in range(7)]
        self.assertEqual(codes, [400] * 5 + [429] * 2)

    @override_settings(LOGIN_IP_THROTTLE_RATE="600/min", LOGIN_USER_THROTTLE_RATE="1000/min")
    def test_missing_user_name_is_not_a_crash(self):
        self.assertEqual(APIClient().post("/api/auth/login/", {}, format="json").status_code, 400)
        self.assertEqual(APIClient().post("/api/auth/login/", {"username": None, "password": "x"}, format="json").status_code, 400)
