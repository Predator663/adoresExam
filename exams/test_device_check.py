"""Pre-exam phone check: the reason a check failed is kept for the teacher who helps.  python manage.py test exams.test_device_check"""
from django.core.cache import cache

from analytics.tests import AnalyticsBase
from core.models import AuditLog
from exams.models import Exam


class DeviceCheckTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.exam = Exam.objects.create(title="Maths", subject=self.maths, start_at=self.start, end_at=self.end, duration_minutes=30, status=Exam.SCHEDULED)
        self.url = f"/api/student/exams/{self.exam.pk}/device-check/"
        self.sc = self.client_for(self.amina)

    def logs(self):
        return AuditLog.objects.filter(action="device.check.failed")

    def test_a_blocked_gps_is_logged_with_its_reason(self):
        r = self.sc.post(self.url, {"gps": "site_denied", "os": "android"}, format="json")
        self.assertEqual((r.status_code, r.json()), (200, {"ok": True, "logged": True}))
        log = self.logs().get()
        self.assertEqual((log.actor_id, log.target), (self.amina.pk, str(self.exam.pk)))
        self.assertEqual((log.detail["gps"], log.detail["os"]), ("site_denied", "android"))

    def test_pressing_check_again_does_not_flood_the_log(self):
        body = {"gps": "services_off", "os": "ios"}
        self.assertTrue(self.sc.post(self.url, body, format="json").json()["logged"])
        self.assertFalse(self.sc.post(self.url, body, format="json").json()["logged"])
        self.assertEqual(self.logs().count(), 1)
        self.sc.post(self.url, {**body, "gps": "no_signal"}, format="json")  # a different reason is news
        self.assertEqual(self.logs().count(), 2)

    def test_wifi_and_bluetooth_are_ignored(self):
        self.sc.post(self.url, {"gps": "ok", "net": "offline", "ble": "off", "os": "android"}, format="json")
        self.assertFalse(self.logs().exists())

    def test_a_passing_check_stores_nothing(self):
        r = self.sc.post(self.url, {"gps": "ok", "os": "android"}, format="json")
        self.assertEqual(r.json(), {"ok": True, "logged": False})
        self.assertFalse(self.logs().exists())

    def test_rough_location_is_logged_as_weak(self):
        self.sc.post(self.url, {"gps": "weak", "os": "android"}, format="json")
        self.assertEqual(self.logs().get().detail["gps"], "weak")

    def test_made_up_values_are_not_stored(self):
        self.sc.post(self.url, {"gps": "<script>alert(1)</script>", "net": "x" * 500, "ble": {"a": 1}, "os": "TempleOS"}, format="json")
        d = self.logs().get().detail
        self.assertEqual((d["gps"], d["os"]), ("unknown", "other"))
        self.assertEqual(self.sc.post(self.url, ["not", "a", "dict"], format="json").status_code, 200)

    def test_only_students_and_only_real_exams(self):
        for who in (self.teacher, self.admin):
            self.assertEqual(self.client_for(who).post(self.url, {"gps": "unknown"}, format="json").status_code, 403)
        self.assertEqual(self.sc.post("/api/student/exams/999999/device-check/", {"gps": "unknown"}, format="json").status_code, 404)
