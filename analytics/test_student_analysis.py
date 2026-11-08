"""Download results page: search a student, see how many questions she got right out of how many.
python manage.py test analytics.test_student_analysis"""
from datetime import timedelta

from rest_framework.test import APIClient

from analytics.studentanalysis import _has_response, _plain, question_status
from analytics.tests import AnalyticsBase
from exams import services
from exams.models import Exam, ExamQuestion
from exams.tests import mcq


class StudentAnalysisTests(AnalyticsBase):
    def exam_of(self, n, picks, title="Term test", subject=None, void=()):
        """An exam of n questions (2 marks each, answer 'b'). picks: {student: [answers in order]}; fewer answers than questions = the rest left blank."""
        exam = Exam.objects.create(title=title, subject=subject or self.maths, start_at=self.start, end_at=self.end,
                                   duration_minutes=30, status=Exam.SCHEDULED, shuffle_questions=False)
        exam.classes.add(self.cls_a, self.cls_b)
        for i in range(1, n + 1):
            ExamQuestion.objects.create(exam=exam, position=i, payload=mcq(), voided=i in void)
        for student, answers in picks.items():
            a = services.start_attempt(exam, student, now=self.start + timedelta(minutes=1))
            for qid, ans in zip(a.order, answers):
                services.submit_answer(a.pk, student, qid, ans, now=self.start + timedelta(minutes=5))
        services.sync_exam(exam)
        exam.refresh_from_db()
        self.assertEqual(exam.status, Exam.PUBLISHED)
        return exam

    def get(self, url, who=None):
        return self.client_for(who or self.admin).get(url)

    def test_x_out_of_21(self):
        picks = ["b"] * 17 + ["a"] * 3  # 17 right, 3 wrong, the 21st never answered
        exam = self.exam_of(21, {self.amina: picks})
        d = self.get(f"/api/exports/results-report/students/{self.amina.pk}/").json()
        e = d["exams"][0]
        self.assertEqual(e["questions"], {"total": 21, "voided": 0, "correct": 17, "partly": 0, "wrong": 3, "unanswered": 1})
        self.assertEqual((e["score"], e["total"]), (34.0, 42.0))
        self.assertEqual(e["exam_id"], exam.pk)
        self.assertEqual([i["status"] for i in e["items"]], ["correct"] * 17 + ["wrong"] * 3 + ["unanswered"])
        self.assertEqual(d["summary"]["questions"], 21)
        self.assertEqual((d["summary"]["correct"], d["summary"]["wrong"], d["summary"]["unanswered"]), (17, 3, 1))
        self.assertEqual(d["student"]["name"], "Amina Test")
        self.assertEqual(d["student"]["class"], "Form 1 A")

    def test_voided_questions_are_not_in_the_out_of(self):
        self.exam_of(21, {self.amina: ["b"] * 21}, void=(21,))
        e = self.get(f"/api/exports/results-report/students/{self.amina.pk}/").json()["exams"][0]
        self.assertEqual(e["questions"], {"total": 20, "voided": 1, "correct": 20, "partly": 0, "wrong": 0, "unanswered": 0})
        self.assertEqual(len(e["items"]), 20)

    def test_several_exams_subjects_topics_and_exam_average(self):
        self.exam_of(2, {self.amina: ["b", "b"], self.zawadi: ["a", "a"]}, title="Maths 1")
        self.exam_of(2, {self.amina: ["b", "a"]}, title="English 1", subject=self.english)
        d = self.get(f"/api/exports/results-report/students/{self.amina.pk}/").json()
        self.assertEqual([e["title"] for e in d["exams"]], ["Maths 1", "English 1"])
        self.assertEqual(d["summary"]["exams"], 2)
        self.assertEqual((d["summary"]["questions"], d["summary"]["correct"], d["summary"]["wrong"]), (4, 3, 1))
        self.assertEqual(d["summary"]["average"], 75.0)  # 100 and 50
        self.assertEqual([(s["subject"], s["correct"], s["questions"]) for s in d["subjects"]], [("English", 1, 2), ("Mathematics", 2, 2)])
        self.assertEqual(d["exams"][0]["exam_average"], 50.0)  # amina 100 and zawadi 0 in Maths 1
        self.assertEqual(d["topics"][0]["topic"], "Algebra")
        self.assertEqual(d["topics"][0]["percent"], 75.0)

    def test_filters_follow_the_page(self):
        m = self.exam_of(2, {self.amina: ["b", "b"]}, title="Maths 1")
        self.exam_of(2, {self.amina: ["a", "a"]}, title="English 1", subject=self.english)
        base = f"/api/exports/results-report/students/{self.amina.pk}/"
        self.assertEqual(len(self.get(base).json()["exams"]), 2)
        self.assertEqual([e["title"] for e in self.get(f"{base}?exam={m.pk}").json()["exams"]], ["Maths 1"])
        self.assertEqual([e["title"] for e in self.get(f"{base}?subject={self.english.pk}").json()["exams"]], ["English 1"])
        self.assertEqual(self.get(f"{base}?exam=abc").status_code, 400)

    def test_nothing_before_publish(self):
        exam = Exam.objects.create(title="Soon", subject=self.maths, start_at=self.start, end_at=self.end + timedelta(hours=5),
                                   duration_minutes=30, status=Exam.LIVE)
        d = self.get(f"/api/exports/results-report/students/{self.amina.pk}/").json()
        self.assertEqual((d["exams"], d["summary"]["exams"], d["summary"]["average"]), ([], 0, None))
        self.assertTrue(exam.pk)

    def test_search(self):
        self.exam_of(2, {self.amina: ["b", "b"]}, title="Maths 1")
        r = self.get("/api/exports/results-report/students/?q=amin").json()["results"]
        self.assertEqual([(x["name"], x["class"], x["results"]) for x in r], [("Amina Test", "Form 1 A", 1)])
        self.assertEqual(self.get("/api/exports/results-report/students/?q=S2").json()["results"][0]["name"], "Zawadi Test")  # by index number
        self.assertEqual(self.get("/api/exports/results-report/students/?q=amina+t").json()["results"][0]["name"], "Amina Test")  # every word must match
        self.assertEqual(self.get("/api/exports/results-report/students/?q=a").json()["results"], [])  # one letter finds nobody
        self.assertEqual(self.get("/api/exports/results-report/students/?q=teach").json()["results"], [])  # staff are not students
        zr = self.get("/api/exports/results-report/students/?q=zawadi").json()["results"]
        self.assertEqual(zr[0]["results"], 0)  # found, but nothing published for her yet

    def test_only_administrators(self):
        urls = ["/api/exports/results-report/students/?q=amina", f"/api/exports/results-report/students/{self.amina.pk}/"]
        for u in urls:
            for who in (self.teacher, self.amina):
                self.assertEqual(self.get(u, who).status_code, 403)
            self.assertEqual(APIClient().get(u).status_code, 401)

    def test_unknown_or_non_student_is_404(self):
        self.assertEqual(self.get("/api/exports/results-report/students/999999/").status_code, 404)
        self.assertEqual(self.get(f"/api/exports/results-report/students/{self.teacher.pk}/").status_code, 404)


class StatusRulesTests(AnalyticsBase):
    def test_question_status(self):
        self.assertEqual(question_status(2, 2, True), "correct")
        self.assertEqual(question_status(1, 2, True), "partly")
        self.assertEqual(question_status(0, 2, True), "wrong")
        self.assertEqual(question_status(-0.5, 2, True), "wrong")  # negative marking
        self.assertEqual(question_status(0, 2, False), "unanswered")
        self.assertEqual(question_status(2, 2.0000000001, True), "correct")  # float noise

    def test_what_counts_as_an_answer(self):
        for empty in (None, "", "   ", [], {}, [""], {"a": ""}, [[], ""]):
            self.assertFalse(_has_response(empty), empty)
        for given in ("b", ["a"], {"x": "y"}, 0, False, ["", "c"]):
            self.assertTrue(_has_response(given), given)

    def test_plain_text_of_a_prompt(self):
        self.assertEqual(_plain("<p>2 &amp; 2 <b>is</b>  4</p>"), "2 & 2 is 4")
        self.assertEqual(len(_plain("x" * 500)), 140)
