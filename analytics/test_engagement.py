"""Engagement score, exam behaviour and device breakdown (administrators only)."""
from datetime import timedelta
from unittest import TestCase as Plain

from django.utils import timezone

from . import engagement as E
from .tests import AnalyticsBase


class ScorePureTests(Plain):
    def test_score_is_explainable_and_bounded(self):
        total, parts, w = E.score(active_days=0, days=30, minutes_per_active_day=0, practice_done=0, taken=0, eligible=0)
        self.assertEqual(total, 0)
        total, parts, w = E.score(active_days=18, days=28, minutes_per_active_day=20, practice_done=12, taken=3, eligible=3)
        self.assertEqual(total, 100)                                   # 4.5 days a week, 20 min, 3 quizzes a week, all exams
        self.assertEqual(set(parts), {"regularity", "time", "practice", "exams"})

    def test_no_exam_held_does_not_punish_her(self):
        total, parts, w = E.score(28, 28, 15, 12, 0, 0)
        self.assertNotIn("exams", parts)
        self.assertEqual(total, 100)

    def test_missing_exams_lowers_the_exam_part_only(self):
        total, parts, _ = E.score(28, 28, 15, 12, 1, 4)
        self.assertEqual(parts["exams"], 25)
        self.assertLess(total, 100)

    def test_trend(self):
        self.assertEqual(E.trend(5, 0, 28), "dropped")
        self.assertEqual(E.trend(2, 6, 28), "up")
        self.assertEqual(E.trend(6, 2, 28), "down")
        self.assertEqual(E.trend(3, 3, 28), "steady")
        self.assertEqual(E.trend(5, 0, 7), "steady")                    # too short a window to say

    def test_notes_are_patterns_not_verdicts(self):
        s = E._summarise([{"time_used": 0.2, "late_start_min": 20, "left_screen": 4, "locked": True, "auto_submitted": False, "skipped": 0, "answers": 12, "timed_out": 0, "sec_per_answer": 2.0},
                          {"time_used": 0.3, "late_start_min": 25, "left_screen": 5, "locked": False, "auto_submitted": False, "skipped": 0, "answers": 12, "timed_out": 0, "sec_per_answer": 3.0}])
        text = " ".join(n["text"] for n in E.notes(s, eligible=4, taken=2, captures=1))
        for part in ("Sat 2 of 4", "starts late", "Finishes very early", "Leaves the exam screen often", "very quickly", "screenshot"):
            self.assertIn(part, text)


class EngagementApiTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        from core.models import AuditLog, PageVisit, Presence
        self.AuditLog, self.PageVisit, self.Presence = AuditLog, PageVisit, Presence
        self.a = self.client_for(self.admin)
        now = timezone.now()
        for d in range(0, 12):   # amina: on the app almost every day
            self.PageVisit.objects.create(user=self.amina, uid=f"a{d}", path="/practice/", screen="Practice", entered_at=now - timedelta(days=d), seconds=900)
        row = self.AuditLog.objects.create(actor=self.amina, action="login", target=str(self.amina.pk), detail={"device_type": "mobile", "os": "Android", "browser": "Chrome"})
        self.Presence.objects.create(user=self.amina, last_seen=now, session_start=now, device_type="mobile", os="Android", browser="Chrome", device="Samsung SM-A315F", standalone=True)
        self.Presence.objects.create(user=self.zawadi, last_seen=now, session_start=now, device_type="desktop", os="Windows", browser="Edge")

    def test_admin_only(self):
        for url in ("/api/analytics/logins/engagement/", f"/api/analytics/logins/engagement/{self.amina.pk}/", "/api/analytics/logins/devices/"):
            self.assertEqual(self.client_for(self.amina).get(url).status_code, 403, url)
            self.assertEqual(self.client_for(self.teacher).get(url).status_code, 403, url)

    def test_engagement_list_ranks_by_use(self):
        r = self.a.get("/api/analytics/logins/engagement/?days=14&sort=score").json()
        rows = r["results"] if "results" in r else r
        self.assertEqual(rows[0]["id"], self.amina.pk)
        self.assertGreater(rows[0]["score"], rows[1]["score"])
        self.assertEqual(rows[1]["tier"], "Not seen")
        self.assertEqual(r["summary"]["students"], 2)

    def test_student_detail_has_parts_and_devices(self):
        d = self.a.get(f"/api/analytics/logins/engagement/{self.amina.pk}/?days=14").json()
        self.assertEqual(set(d["parts"]) >= {"regularity", "time", "practice"}, True)
        self.assertEqual(d["devices_used"][0]["os"], "Android")
        self.assertEqual(d["device"]["device"], "Samsung SM-A315F")

    def test_device_breakdown(self):
        d = self.a.get("/api/analytics/logins/devices/?days=14").json()
        self.assertEqual(d["seen"], 2)
        self.assertEqual({x["label"]: x["count"] for x in d["type"]}, {"Mobile": 1, "Desktop": 1})
        self.assertEqual({x["label"] for x in d["browser"]}, {"Chrome", "Edge"})
        self.assertEqual(d["installed"], 1)
        self.assertEqual(d["logins"]["recorded"], 1)

    def test_a_login_records_the_device(self):
        from rest_framework.test import APIClient
        c = APIClient()
        self.amina.set_password("x-Strong-pass-1"); self.amina.save()
        r = c.post("/api/auth/login/", {"username": self.amina.username, "password": "x-Strong-pass-1"}, format="json",
                   HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 13; SM-A315F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")
        self.assertEqual(r.status_code, 200, r.content)
        last = self.AuditLog.objects.filter(actor=self.amina, action="login").latest("id")
        self.assertEqual((last.detail["device_type"], last.detail["os"], last.detail["browser"]), ("mobile", "Android", "Chrome"))

    def test_screen_guard_log_only_when_on(self):
        from core.models import SchoolSettings
        s = self.client_for(self.amina)
        self.assertEqual(s.post("/api/screen-guard/", {"kind": "printscreen", "path": "/exam/5/"}, format="json").status_code, 204)
        self.assertEqual(self.AuditLog.objects.filter(action="screen.capture").count(), 0)      # protection off: nothing is logged
        st = SchoolSettings.load(); st.screen_protection = "all"; st.save()
        s.post("/api/screen-guard/", {"kind": "printscreen", "path": "/exam/5/"}, format="json")
        self.assertEqual(self.AuditLog.objects.filter(action="screen.capture").count(), 1)

    def test_admin_switch_and_students_can_read_it(self):
        self.assertEqual(self.a.patch("/api/settings/", {"screen_protection": "exams"}, format="json").status_code, 200)
        self.assertEqual(self.client_for(self.amina).get("/api/settings/").json()["screen_protection"], "exams")
        self.assertEqual(self.a.patch("/api/settings/", {"screen_protection": "maybe"}, format="json").status_code, 400)

    def test_exam_behaviour_appears_for_the_student(self):
        from exams.models import Attempt, AttemptEvent
        exam, attempts = self.make_exam(self.maths, "Midterm", {self.amina: ["b", "a"]})
        att = attempts[self.amina.pk]
        for _ in range(4):
            AttemptEvent.objects.create(attempt=att, kind="left_screen")
        d = self.a.get(f"/api/analytics/logins/engagement/{self.amina.pk}/?days=30").json()
        self.assertEqual([a["exam"] for a in d["attempts"]], ["Midterm"])
        self.assertEqual(d["attempts"][0]["left_screen"], 4)
        self.assertIsNotNone(d["attempts"][0]["percent"])
        self.assertEqual(d["behaviour"]["left_screen_total"], 4)
        self.assertEqual(d["exams_taken"], 1)
