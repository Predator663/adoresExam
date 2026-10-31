from django.db import connection
from django.test import SimpleTestCase, TestCase

from . import cache
from .middleware import clean_host, schema_from_device_token
from .models import Domain, School
from .storage import SchoolFileSystemStorage


class HelpersTests(SimpleTestCase):
    def test_clean_host(self):
        self.assertEqual(clean_host("https://Exams.School.ac.tz:443/x?y=1"), "exams.school.ac.tz")
        self.assertEqual(clean_host("localhost:3000"), "localhost")
        for bad in ("", None, "a b", "exa_mples.com", "../etc", "-x.com"):
            self.assertEqual(clean_host(bad), "", bad)

    def test_device_token_names_the_school(self):
        self.assertEqual(schema_from_device_token("amani.Xy12-_ab"), "amani")
        self.assertEqual(schema_from_device_token("Xy12-_abNoDot"), "")  # an old token: LEGACY_SCHOOL_SCHEMA handles it
        self.assertEqual(schema_from_device_token("Bad Name.abc"), "")
        self.assertEqual(schema_from_device_token(""), "")


class SchoolScopedTests(TestCase):
    def tearDown(self):
        connection.set_schema_to_public()

    def test_cache_key_and_media_folder_follow_the_school(self):
        connection.set_schema("demo_a")
        self.assertIn(":demo_a:", cache.make_key("k", "p", 1))
        self.assertEqual(SchoolFileSystemStorage().base_url, "/media/demo_a/")
        self.assertTrue(SchoolFileSystemStorage().location.endswith("/demo_a"))
        connection.set_schema_to_public()
        self.assertIn(":public:", cache.make_key("k", "p", 1))

    def _school(self, schema="demo_a", host="demo.test", active=True):
        s = School(schema_name=schema, name="Demo", is_active=active)
        s.auto_create_schema = False  # tests do not need the school's own tables
        s.save()
        Domain.objects.create(domain=host, tenant=s, is_primary=True)
        return s

    def test_header_picks_the_school(self):
        self._school()
        r = self.client.get("/api/site-status/", HTTP_X_SCHOOL="Demo.Test")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.wsgi_request.tenant.schema_name, "demo_a")

    def test_unknown_school_is_refused_clearly(self):
        r = self.client.get("/api/site-status/", HTTP_X_SCHOOL="nobody.test")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["code"], "unknown_school")

    def test_suspended_school_is_refused(self):
        self._school(active=False)
        r = self.client.get("/api/site-status/", HTTP_X_SCHOOL="demo.test")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "school_suspended")

    def test_phone_token_picks_the_school(self):
        self._school()
        r = self.client.get("/api/sms/ping/", HTTP_X_DEVICE_TOKEN="demo_a.whatever")
        self.assertEqual(r.wsgi_request.tenant.schema_name, "demo_a")
        r = self.client.get("/api/sms/ping/", HTTP_X_DEVICE_TOKEN="ghost.whatever")
        self.assertEqual(r.status_code, 404)

    def test_no_clue_means_the_platform(self):
        r = self.client.get("/api/site-status/")
        self.assertEqual(r.wsgi_request.tenant.schema_name, "public")

    def test_registered_address_may_call_the_api_from_the_browser(self):
        from . import cors
        self._school()
        cors.forget()
        r = self.client.get("/api/site-status/", HTTP_X_SCHOOL="demo.test", HTTP_ORIGIN="https://demo.test")
        self.assertEqual(r.headers.get("Access-Control-Allow-Origin"), "https://demo.test")
        r = self.client.get("/api/site-status/", HTTP_X_SCHOOL="demo.test", HTTP_ORIGIN="https://evil.example")
        self.assertIsNone(r.headers.get("Access-Control-Allow-Origin"))


class BrandingTests(TestCase):
    def test_branding_is_public_and_derives_the_short_name(self):
        r = self.client.get("/api/branding/")  # no login: the login page needs it
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d["school_name"], "Amani Girls Secondary School")
        self.assertEqual(d["short_name"], "Amani")
        self.assertIsNone(d["logo_url"])

    def test_identity_written_for_a_school_shows_in_branding_and_in_the_sms_wording(self):
        from core.models import SchoolSettings
        from guardians import services
        from .branding import set_identity
        set_identity("Kilimo Secondary School", short_name="Kilimo", email="info@kilimo.test", phone="0700 000 000", address="Moshi")
        d = self.client.get("/api/branding/").json()
        self.assertEqual((d["school_name"], d["short_name"], d["contact_email"], d["address"]), ("Kilimo Secondary School", "Kilimo", "info@kilimo.test", "Moshi"))
        self.assertTrue(services.default_messages()["en"].startswith("Kilimo: exam login."))
        SchoolSettings.objects.update(short_name="")
        self.assertTrue(services.default_messages()["en"].startswith("Kilimo Secondary: exam login."))
