"""Student page-visit log: what the app may send, what is stored, and who may read it.
Run:  python manage.py test core.test_page_visits"""
from django.core.cache import cache
from django.test import SimpleTestCase

from core import pagevisits
from core.models import AuditLog, PageVisit
from exams.tests import Base


class NormaliseTests(SimpleTestCase):
    def test_query_hash_and_ids_are_dropped(self):
        self.assertEqual(pagevisits.normalise("/results/?term=2&x=secret#top"), "/results/")
        self.assertEqual(pagevisits.normalise("/messages/123/"), "/messages/:id/")
        self.assertEqual(pagevisits.normalise("/practice"), "/practice/")
        self.assertEqual(pagevisits.normalise("/"), "/")

    def test_things_that_are_not_app_screens_are_refused(self):
        for bad in ("", None, "https://evil.example/x", "//evil.example", "results", "/a b/", "/<script>/", "/" + "x" * 130):
            self.assertEqual(pagevisits.normalise(bad), "", bad)

    def test_screen_names(self):
        self.assertEqual(pagevisits.screen_name("/results/"), "Results")
        self.assertEqual(pagevisits.screen_name("/some-new-page/"), "Some new page")


class VisitApiTests(Base):
    def post(self, user, visits, **extra):
        cache.clear()  # one upload per 3 seconds per person is allowed: tests upload faster than that
        return self.client_for(user).post("/api/page-visits/", {"visits": visits, **extra}, format="json")

    def test_student_batch_is_stored_cleaned_and_not_duplicated(self):
        batch = [{"uid": "a1", "path": "/results/?term=2#x", "ago": 30, "seconds": 45}, {"uid": "a2", "path": "/messages/9/", "ago": 5, "seconds": 7},
                 {"uid": "a1", "path": "/results/", "ago": 30, "seconds": 45}, {"uid": "bad", "path": "http://evil", "ago": 1, "seconds": 1},
                 {"uid": "old", "path": "/results/", "ago": 99999999, "seconds": 5}, "junk", {"path": "/results/"}]
        r = self.post(self.amina, batch, standalone=True)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["saved"], 2)
        rows = {v.uid: v for v in PageVisit.objects.filter(user=self.amina)}
        self.assertEqual(rows["a1"].path, "/results/")
        self.assertEqual(rows["a1"].screen, "Results")
        self.assertEqual(rows["a2"].path, "/messages/:id/")
        self.assertTrue(rows["a1"].standalone)
        self.post(self.amina, [batch[0]])  # the same upload again (a retry) adds nothing
        self.assertEqual(PageVisit.objects.filter(user=self.amina).count(), 2)

    def test_one_stay_is_capped_at_four_hours(self):
        self.post(self.amina, [{"uid": "long", "path": "/practice/", "ago": 10, "seconds": 999999}])
        self.assertEqual(PageVisit.objects.get(uid="long").seconds, 4 * 3600)

    def test_only_students_are_logged(self):
        for who in (self.admin,):
            self.assertEqual(self.post(who, [{"uid": "t1", "path": "/staff/", "ago": 1, "seconds": 9}]).status_code, 204)
        self.assertEqual(PageVisit.objects.count(), 0)

    def test_uploads_are_rate_limited(self):
        c = self.client_for(self.amina)
        cache.clear()
        v = {"visits": [{"uid": "r1", "path": "/results/", "ago": 1, "seconds": 3}]}
        self.assertEqual(c.post("/api/page-visits/", v, format="json").status_code, 200)
        self.assertEqual(c.post("/api/page-visits/", v, format="json").status_code, 429)


class VisitReadTests(Base):
    def setUp(self):
        super().setUp()
        cache.clear()
        PageVisit.objects.create(user=self.amina, uid="u1", path="/results/", screen="Results", entered_at=self.start, seconds=40, device_type="mobile")
        PageVisit.objects.create(user=self.amina, uid="u2", path="/practice/", screen="Practice", entered_at=self.start, seconds=200, device_type="desktop", standalone=True)

    def test_students_cannot_read_the_log(self):
        for url in ("/api/page-visits/log/", "/api/page-visits/summary/"):
            self.assertEqual(self.client_for(self.amina).get(url).status_code, 403)

    def test_admin_filters(self):
        c = self.client_for(self.admin)
        self.assertEqual(c.get("/api/page-visits/log/").json()["count"], 2)
        self.assertEqual(c.get("/api/page-visits/log/?screen=Practice").json()["count"], 1)
        self.assertEqual(c.get("/api/page-visits/log/?device=mobile").json()["results"][0]["screen"], "Results")
        self.assertEqual(c.get("/api/page-visits/log/?installed=1").json()["count"], 1)
        self.assertEqual(c.get("/api/page-visits/log/?min_seconds=100").json()["count"], 1)
        self.assertEqual(c.get(f"/api/page-visits/log/?q={self.amina.username}").json()["count"], 2)
        self.assertEqual(c.get("/api/page-visits/log/?q=nobodyhere").json()["count"], 0)
        self.assertEqual(c.get("/api/page-visits/log/?sort=longest").json()["results"][0]["screen"], "Practice")
        self.assertEqual(c.get("/api/page-visits/log/?page=1&page_size=1").json()["pages"], 2)

    def test_summary(self):
        s = self.client_for(self.admin).get("/api/page-visits/summary/").json()
        self.assertEqual((s["visits"], s["students"], s["total_seconds"]), (2, 1, 240))
        self.assertEqual({x["screen"] for x in s["top_screens"]}, {"Results", "Practice"})
        self.assertIn("Practice", s["screens"])

    def test_csv_download_is_audited(self):
        r = self.client_for(self.admin).get("/api/page-visits/log/?file=csv&screen=Results")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r["Content-Type"].startswith("text/csv"))
        body = r.content.decode("utf-8-sig")
        self.assertIn("Screen", body.splitlines()[0])
        self.assertIn("Results", body)
        self.assertNotIn("Practice", body)
        self.assertTrue(AuditLog.objects.filter(action="export.page_visits").exists())
