from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from analytics.tests import AnalyticsBase
from .models import Presence
from .presence import parse_ua

PHONE = "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
HIDDEN = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"


class UserAgentTests(AnalyticsBase):
    def test_parses_phones_and_desktops(self):
        a = parse_ua(PHONE)
        self.assertEqual((a["browser"], a["os"], a["os_version"], a["device_type"], a["device"]), ("Chrome", "Android", "13", "mobile", "Samsung SM-A135F"))
        self.assertEqual(parse_ua(HIDDEN)["device"], "")  # Chrome hides the model; the app sends it separately
        i = parse_ua(IPHONE)
        self.assertEqual((i["browser"], i["os"], i["os_version"], i["device"]), ("Safari", "iOS", "17.2", "iPhone"))
        self.assertEqual(parse_ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0")["browser"], "Edge")
        self.assertEqual(parse_ua("")["device_type"], "desktop")


class OnlineNowTests(AnalyticsBase):
    def beat(self, user, ua=PHONE, **body):
        cache.delete(f"presence:w:{user.pk}")
        return self.client_for(user).post("/api/presence/", body, format="json", HTTP_USER_AGENT=ua, HTTP_X_FORWARDED_FOR="41.59.1.7")

    def test_everyone_is_recorded_and_the_admin_sees_the_split(self):
        self.beat(self.amina, model="SM-A135F", screen="393x851", connection="4g")
        self.beat(self.zawadi, IPHONE)
        self.beat(self.teacher, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36")
        self.beat(self.admin)
        d = self.client_for(self.admin).get("/api/online-now/").json()
        c = d["counts"]
        self.assertEqual((c["online"], c["students"], c["teachers"], c["admins"], c["mobile"], c["desktop"]), (4, 2, 1, 1, 3, 1))
        me = next(p for p in d["people"] if p["username"] == "amina")
        self.assertEqual((me["device"], me["ip"], me["screen"], me["connection"], me["class"]), ("Samsung SM-A135F", "41.59.1.7", "393x851", "4g", "Form 1 A"))
        self.assertEqual(me["same_ip"], 4)
        self.assertTrue(d["browsers"] and d["systems"] and d["classes"])

    def test_the_browser_model_hint_fills_in_a_hidden_model(self):
        self.beat(self.amina, HIDDEN, model="TECNO KG5k", platform_version="12.0.0")
        p = Presence.objects.get(user=self.amina)
        self.assertEqual((p.device, p.os_version), ("TECNO KG5k", "12"))

    def test_gone_after_two_minutes_and_sessions_restart_after_a_break(self):
        self.beat(self.amina)
        Presence.objects.filter(user=self.amina).update(last_seen=timezone.now() - timedelta(minutes=3))
        d = self.client_for(self.admin).get("/api/online-now/").json()
        self.assertEqual(d["counts"]["online"], 0)
        self.assertEqual(d["counts"]["active_today"], 1)
        self.assertFalse(d["people"][0]["online"])
        old = Presence.objects.get(user=self.amina).session_start
        self.beat(self.amina)  # back after only 3 minutes: the same session goes on
        self.assertEqual(Presence.objects.get(user=self.amina).session_start, old)
        Presence.objects.filter(user=self.amina).update(last_seen=timezone.now() - timedelta(minutes=6))
        self.beat(self.amina)
        self.assertGreater(Presence.objects.get(user=self.amina).session_start, old)

    def test_only_administrators_may_look(self):
        for u in (self.amina, self.teacher):
            self.assertEqual(self.client_for(u).get("/api/online-now/").status_code, 403)
        self.assertIn(APIClient_anon().get("/api/online-now/").status_code, (401, 403))

    def test_writes_are_throttled(self):
        self.beat(self.amina)
        first = Presence.objects.get(user=self.amina).last_seen
        self.client_for(self.amina).post("/api/presence/", {}, format="json", HTTP_USER_AGENT=PHONE)  # within 55 s: no second write
        self.assertEqual(Presence.objects.get(user=self.amina).last_seen, first)


def APIClient_anon():
    from rest_framework.test import APIClient
    return APIClient()
