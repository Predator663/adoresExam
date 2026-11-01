from django.test import SimpleTestCase

from core.exceptions import friendly_exception_handler


class FriendlyErrorTests(SimpleTestCase):
    def test_a_crash_becomes_a_plain_message_with_no_technical_detail(self):
        with self.assertLogs("amani.errors", level="ERROR"):
            r = friendly_exception_handler(RuntimeError("psycopg.OperationalError at /srv/app/exams/views.py line 9"), {"request": None})
        self.assertEqual((r.status_code, r.data["code"]), (500, "server_error"))
        self.assertNotIn("psycopg", str(r.data))
        self.assertNotIn(".py", str(r.data))
