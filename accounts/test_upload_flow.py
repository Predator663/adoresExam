"""The student upload screen: pick a class, tailored template, tidy names, skip known index numbers.  Run:  python manage.py test accounts.test_upload_flow"""
import io

from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook, load_workbook

from academics.models import SchoolClass
from accounts.models import User
from analytics.tests import AnalyticsBase

BASE = "/api/students/bulk-upload"


def csv_file(text, name="s.csv"):
    return SimpleUploadedFile(name, text.encode(), content_type="text/csv")


class UploadFlowTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        self.a = self.client_for(self.admin)

    def check(self, text, **opts):
        return self.a.post(f"{BASE}/validate/", {"file": csv_file(text), **opts}, format="multipart")

    def confirm(self, r):
        return self.a.post(f"{BASE}/{r.json()['batch_id']}/confirm/", {"skip_invalid": True}, format="json")

    def test_one_class_chosen_on_screen_needs_no_class_columns(self):
        r = self.check("Surname,First name,Index\nJuma,neema,A1\nAli,RAHMA,A2\n", **{"class": self.cls_a.pk, "tidy": "1"})
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual((d["valid_rows"], d["invalid_rows"]), (2, 0))
        self.assertEqual(d["by_class"][0]["class"], str(self.cls_a))
        self.assertEqual(d["preview"][0]["first_name"], "Neema")  # tidy
        self.assertEqual(self.confirm(r).status_code, 200)
        self.assertEqual(User.objects.filter(index_number__in=["A1", "A2"], school_class=self.cls_a).count(), 2)

    def test_a_new_class_by_name_is_created_and_form_zero_is_allowed(self):
        r = self.check("First name,Last name,Index number\nA,B,Z1\n", class_name="Form 0", class_stream="a")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["new_classes"], ["Form 0 A"])
        self.confirm(r)
        self.assertTrue(SchoolClass.objects.filter(name="Form 0", stream="A", form_level=0).exists())
        self.assertEqual(self.check("A,B,Z9\n", class_name="Primary").status_code, 400)  # no form number

    def test_unknown_classes_can_be_refused_and_names_matched_loosely(self):
        text = "First name,Last name,Index number,Class,Stream\nA,B,C1,2,\nA,B,C2,form 9,\n"
        r = self.check(text, create_classes="0")
        self.assertEqual(r.status_code, 200, r.content)
        d = r.json()
        self.assertEqual(d["invalid_rows"], 2)  # no "Form 2" in the school and none may be created
        r2 = self.check(text, create_classes="1")
        self.assertEqual(r2.json()["valid_rows"], 1)  # "form 9" has no number 0-4

    def test_known_index_numbers_can_be_skipped_instead_of_flagged(self):
        User.objects.filter(pk=self.amina.pk).update(index_number="K1")
        text = "First name,Last name,Index number,Class or form\nA,B,K1,Form 1\nC,D,K2,Form 1\n"
        flagged = self.check(text).json()
        self.assertEqual((flagged["invalid_rows"], flagged["skipped"]), (1, 0))
        skipped = self.check(text, existing="skip").json()
        self.assertEqual((skipped["invalid_rows"], skipped["skipped"], skipped["valid_rows"]), (0, 1, 1))

    def test_full_name_column_and_numeric_excel_cells(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["Student name", "Index no", "Class"])
        ws.append(["Neema Mary Juma", 1234.0, "Form 1"])
        buf = io.BytesIO()
        wb.save(buf)
        r = self.a.post(f"{BASE}/validate/", {"file": SimpleUploadedFile("s.xlsx", buf.getvalue())}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        row = r.json()["preview"][0]
        self.assertEqual((row["first_name"], row["last_name"], row["index_number"]), ("Neema", "Mary Juma", "1234"))

    def test_username_style(self):
        text = "First name,Last name,Index number,Class or form\nNeema,Juma-Ali,U1,Form 1\nNeema,Juma-Ali,U2,Form 1\n"
        r = self.check(text, username_style="first.last")
        self.assertEqual([p["username"] for p in r.json()["preview"]], ["neema.jumaali", "neema.jumaali2"])
        self.confirm(r)
        self.assertTrue(User.objects.filter(username="neema.jumaali2").exists())

    def test_template_options_and_class_list(self):
        old = self.a.get(f"{BASE}/template/").content.decode().splitlines()[0]
        self.assertTrue(old.startswith("First Name,Last Name,Index Number,Class Or Form,Stream,Parent Name"))
        one = self.a.get(f"{BASE}/template/?class={self.cls_a.pk}&parents=0").content.decode().splitlines()[0]
        self.assertEqual(one, "First Name,Last Name,Index Number")
        x = self.a.get(f"{BASE}/template/?parents=1&format=xlsx")
        self.assertEqual(x.status_code, 200)
        wb = load_workbook(io.BytesIO(x.content))
        self.assertEqual(wb.sheetnames, ["Students", "Classes", "How to fill"])
        self.assertEqual([c.value for c in wb["Students"][1]][:5], ["First Name", "Last Name", "Index Number", "Class Or Form", "Stream"])
        self.assertEqual(self.a.get(f"{BASE}/template/?class=99999").status_code, 400)
        opts = self.a.get(f"{BASE}/options/").json()["classes"]
        self.assertIn(str(self.cls_a), [c["label"] for c in opts])
        self.assertEqual(self.client_for(self.teacher).get(f"{BASE}/options/").status_code, 403)


class UploadSafetyTests(AnalyticsBase):
    def setUp(self):
        super().setUp()
        self.a = self.client_for(self.admin)

    def test_cells_too_long_for_the_database_are_flagged_before_anything_is_created(self):
        text = "First name,Last name,Index number,Class or form\nA,B," + "9" * 60 + ",Form 1\nC,D,OK1,Form 1\n"
        r = self.a.post(f"{BASE}/validate/", {"file": csv_file(text)}, format="multipart").json()
        self.assertEqual((r["valid_rows"], r["invalid_rows"]), (1, 1))
        self.assertIn("longer than 40", r["errors"][0]["problems"][0])

    def test_usernames_that_differ_only_by_case_get_a_number(self):
        User.objects.create_user(username="neema", password="x", role="student", first_name="Old", last_name="One")
        text = "First name,Last name,Index number,Class or form\nNEEMA,B,Q1,Form 1\n"
        r = self.a.post(f"{BASE}/validate/", {"file": csv_file(text)}, format="multipart")
        self.assertEqual(r.json()["preview"][0]["username"], "neema2")
        self.assertEqual(self.a.post(f"{BASE}/{r.json()['batch_id']}/confirm/", {"skip_invalid": True}, format="json").status_code, 200)
