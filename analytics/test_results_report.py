"""Full school results report. Run:  python manage.py test analytics.test_results_report"""
import io
from datetime import datetime, timedelta
from unittest import TestCase as PlainTestCase

from django.utils import timezone

from openpyxl import load_workbook

from core import grading
from core.models import AuditLog
from exams.models import Exam
from . import fullreport
from .tests import AnalyticsBase

SCALE = grading.DEFAULT_SCALE


def row(sid, subject, percent, exam=1, cls=1, label="Form 1 A"):
    g = grading.grade_for(percent, SCALE)
    return {"result_id": sid * 1000 + exam, "attempt_id": 1, "attempt_no": 1, "student_id": sid, "student_name": f"S{sid}",
            "class_id": cls, "class_label": label, "stream": "A", "exam_id": exam, "exam_title": "t", "subject_id": 1,
            "subject": subject, "term_id": 1, "date": datetime(2026, 9, 1), "percent": percent, "grade": g["grade"],
            "points": g["points"], "passed": percent >= 30, "time_taken": 60, "topic_stats": {}, "scale": SCALE}


def person(sid, name=None, cls=1, label="Form 1 A", form=1):
    return {"name": name or f"Student {sid}", "index_number": f"I{sid}", "class_id": cls, "class_label": label, "form_level": form, "stream": "A"}


class CalculationTests(PlainTestCase):
    def test_gpa_points_follow_the_scale(self):
        self.assertEqual(fullreport.grade_points_map(SCALE), {"A": 5, "B": 4, "C": 3, "D": 2, "F": 1})
        edited = {**SCALE, "grades": [{**g, "points": g["points"] + 1} for g in SCALE["grades"]]}  # points 2..6
        self.assertEqual(fullreport.grade_points_map(edited)["A"], 5)  # still best = highest, worst = 1

    def test_student_gpa_uses_best_seven_subjects(self):
        nine = [("A", 1)] * 7 + [("F", 5)] * 2
        self.assertEqual(fullreport.student_gpa(nine, SCALE), 5.0)
        self.assertEqual(fullreport.student_gpa([("A", 1), ("C", 3)], SCALE), 4.0)  # fewer than 7: all count
        self.assertIsNone(fullreport.student_gpa([], SCALE))

    def test_counts_division_and_incomplete(self):
        subjects = [f"Sub{i}" for i in range(7)]
        rows = [row(1, s, 90) for s in subjects]          # seven A: 7 points, division I
        rows += [row(2, s, 10) for s in subjects[:3]]     # three F: too few subjects for a division
        rep = fullreport.build(rows, {1: person(1), 2: person(2)}, SCALE)
        self.assertEqual(rep["grade_counts"], {"A": 7, "B": 0, "C": 0, "D": 0, "F": 3})
        self.assertEqual(rep["division_counts"]["I"], 1)
        self.assertEqual(rep["division_counts"]["Incomplete"], 1)
        first = rep["students"][0]
        self.assertEqual((first["student_id"], first["division"], first["total_points"], first["gpa"]), (1, "I", 7, 5.0))
        self.assertIsNone(rep["students"][1]["division"])
        self.assertEqual(rep["summary"]["pass_rate"], 70.0)

    def test_top_and_worst_never_repeat_a_student(self):
        rows = [row(i, "Maths", 100 - i * 10) for i in range(1, 8)]
        rep = fullreport.build(rows, {i: person(i) for i in range(1, 8)}, SCALE, top_n=5)
        top, worst = [p["student_id"] for p in rep["top"]], [p["student_id"] for p in rep["worst"]]
        self.assertEqual(top, [1, 2, 3, 4])      # fewer than 2 x 5 students: the ranking is split in two halves
        self.assertEqual(worst, [7, 6, 5])       # lowest first
        self.assertFalse(set(top) & set(worst))
        many = fullreport.build([row(i, "Maths", 100 - i) for i in range(1, 31)], {i: person(i) for i in range(1, 31)}, SCALE, top_n=10)
        self.assertEqual(([p["student_id"] for p in many["top"]], [p["student_id"] for p in many["worst"]][:2]),
                         (list(range(1, 11)), [30, 29]))
        self.assertEqual((len(many["top"]), len(many["worst"])), (10, 10))

    def test_equal_scores_share_a_rank(self):
        rows = [row(1, "Maths", 80), row(2, "Maths", 80), row(3, "Maths", 50)]
        rep = fullreport.build(rows, {i: person(i) for i in (1, 2, 3)}, SCALE)
        self.assertEqual([p["rank"] for p in rep["students"]], [1, 1, 3])

    def test_a_retake_is_not_double_counted_by_the_caller_but_two_exams_are_averaged(self):
        rows = [row(1, "Maths", 100, exam=1), row(1, "Maths", 50, exam=2)]
        rep = fullreport.build(rows, {1: person(1)}, SCALE)
        self.assertEqual(rep["students"][0]["marks"]["Maths"], {"average": 75.0, "grade": "A", "points": 1, "exams": 2})

    def test_students_without_results_are_listed_last_only_when_asked(self):
        rows = [row(1, "Maths", 70)]
        people = {1: person(1), 2: person(2, "No Marks")}
        self.assertEqual(len(fullreport.build(rows, people, SCALE)["students"]), 1)
        rep = fullreport.build(rows, people, SCALE, include_empty=True)
        self.assertEqual([p["has_results"] for p in rep["students"]], [True, False])
        self.assertEqual(rep["summary"]["students_without_results"], 1)
        ordered = fullreport.sort_students(rep["students"], "average", "desc")
        self.assertEqual(ordered[-1]["name"], "No Marks")
        ordered = fullreport.sort_students(rep["students"], "average", "asc")
        self.assertEqual(ordered[-1]["name"], "No Marks")  # no value: last whatever the direction

    def test_sorting_by_name_and_class(self):
        rows = [row(1, "Maths", 70), row(2, "Maths", 60), row(3, "Maths", 50)]
        people = {1: person(1, "Zawadi"), 2: person(2, "Amina", 2, "Form 1 B"), 3: person(3, "Mary", 1)}
        rep = fullreport.build(rows, people, SCALE)
        self.assertEqual([p["name"] for p in fullreport.sort_students(rep["students"], "name")], ["Amina", "Mary", "Zawadi"])
        self.assertEqual([p["name"] for p in fullreport.sort_students(rep["students"], "name", "desc")], ["Zawadi", "Mary", "Amina"])
        self.assertEqual([p["class_label"] for p in fullreport.sort_students(rep["students"], "class")], ["Form 1 A", "Form 1 A", "Form 1 B"])
        self.assertEqual(fullreport.sort_students(rep["students"], "nonsense")[0]["rank"], 1)  # unknown key = rank


class ReportApiTests(AnalyticsBase):
    URL = "/api/exports/results-report/"

    def seed(self):
        self.make_exam(self.maths, picks={self.amina: ["b", "b"], self.zawadi: ["a", "a"]})   # amina 100% (A), zawadi 0% (F)
        self.make_exam(self.english, "Eng", picks={self.amina: ["b", "b"], self.zawadi: ["b", "b"]})

    def test_only_administrators_may_download(self):
        self.seed()
        for who in (self.teacher, self.amina):
            c = self.client_for(who)
            self.assertEqual(c.get(self.URL).status_code, 403)
            self.assertEqual(c.get(self.URL + "preview/").status_code, 403)
            self.assertEqual(c.get(self.URL + "options/").status_code, 403)
        self.assertEqual(APIClientAnon().get(self.URL).status_code, 401)

    def test_preview_counts_grades_students_and_gpa(self):
        self.seed()
        d = self.client_for(self.admin).get(self.URL + "preview/").json()
        self.assertEqual(d["grade_counts"], {"A": 3, "B": 0, "C": 0, "D": 0, "F": 1})
        self.assertEqual(d["summary"]["students_with_results"], 2)
        self.assertEqual(d["summary"]["results"], 4)
        self.assertEqual(d["top"][0]["name"], "Amina Test")
        self.assertEqual(d["top"][0]["average"], 100.0)
        self.assertEqual(d["worst"][0]["name"], "Zawadi Test")
        self.assertEqual(d["division_counts"]["Incomplete"], 2)      # only two subjects: no division yet
        self.assertEqual(d["summary"]["gpa"], 4.0)                    # amina 5.0; zawadi (F=1 and A=5) 3.0; school = mean
        self.assertEqual([f["label"] for f in d["filters"]], ["School", "Class", "Term", "Subject", "Exam"])

    def test_filters_narrow_the_report(self):
        self.seed()
        c = self.client_for(self.admin)
        one_class = c.get(self.URL + f"preview/?class={self.cls_a.pk}").json()
        self.assertEqual(one_class["summary"]["students_with_results"], 1)
        self.assertEqual(one_class["filters"][1]["value"], "Form 1 A")
        form = c.get(self.URL + "preview/?form=1").json()
        self.assertEqual(form["summary"]["students_with_results"], 2)
        self.assertEqual(form["filters"][1]["value"], "Form 1 (all streams)")
        only_maths = c.get(self.URL + f"preview/?subject={self.maths.pk}").json()
        self.assertEqual(only_maths["summary"]["subjects"], 1)
        self.assertEqual(only_maths["grade_counts"]["F"], 1)
        self.assertEqual(c.get(self.URL + "preview/?class=99999").status_code, 404)

    def test_bad_filters_are_refused_in_plain_words(self):
        c = self.client_for(self.admin)
        for q in ("sort=nonsense", "dir=sideways", "top=0", "top=500", "class=abc", "sections=summary,secrets", "file=exe"):
            r = c.get(self.URL + f"?{q}")
            self.assertEqual(r.status_code, 400, q)
            self.assertIn("detail", r.json())

    def test_pdf_and_excel_files(self):
        self.seed()
        c = self.client_for(self.admin)
        pdf = c.get(self.URL + "?file=pdf&empty=1")
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertIn(".pdf", pdf["Content-Disposition"])
        xl = c.get(self.URL + "?file=xlsx&sort=name&dir=desc&top=5")
        self.assertEqual(xl.status_code, 200)
        wb = load_workbook(io.BytesIO(xl.content))
        self.assertEqual(wb.sheetnames, ["Summary", "Top and bottom", "Subjects", "Classes", "Students"])
        ws = wb["Students"]
        names = [r[2] for r in ws.iter_rows(min_row=1, values_only=True) if r[2] in ("Amina Test", "Zawadi Test")]
        self.assertEqual(names, ["Zawadi Test", "Amina Test"])       # sorted by name, descending

    def test_sections_can_be_left_out(self):
        self.seed()
        xl = self.client_for(self.admin).get(self.URL + "?file=xlsx&sections=summary,students")
        self.assertEqual(load_workbook(io.BytesIO(xl.content)).sheetnames, ["Summary", "Students"])

    def test_a_report_with_no_results_still_downloads(self):
        c = self.client_for(self.admin)
        for kind in ("pdf", "xlsx"):
            r = c.get(self.URL + f"?file={kind}")
            self.assertEqual(r.status_code, 200)
            self.assertGreater(len(r.content), 500)

    def test_download_is_audited(self):
        self.seed()
        self.client_for(self.admin).get(self.URL + "?file=pdf")
        entry = AuditLog.objects.filter(action="export.full_results").first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.detail["file"], "pdf")

    def test_options_list_what_can_be_chosen(self):
        self.seed()
        d = self.client_for(self.admin).get(self.URL + "options/").json()
        self.assertEqual({c["label"] for c in d["classes"]}, {"Form 1 A", "Form 1 B"})
        self.assertEqual(d["forms"], [1])
        self.assertEqual({s["name"] for s in d["subjects"]}, {"Mathematics", "English"})
        self.assertEqual(len(d["exams"]), 2)
        self.assertEqual([s["key"] for s in d["sorts"]][0], "rank")

    def test_results_of_a_draft_exam_are_never_in_the_report(self):
        exam, _ = self.make_exam(self.maths, picks={self.amina: ["b", "b"]}, publish=False)
        Exam.objects.filter(pk=exam.pk).update(end_at=timezone.now() + timedelta(hours=1), status=Exam.LIVE)  # still running
        d = self.client_for(self.admin).get(self.URL + "preview/").json()
        self.assertEqual(d["summary"]["results"], 0)


def APIClientAnon():
    from rest_framework.test import APIClient
    return APIClient()
