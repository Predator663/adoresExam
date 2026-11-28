from django.conf import settings
from django.db import models
from django.db.models import Q


class Exam(models.Model):
    DRAFT, SCHEDULED, LIVE, CLOSED, PUBLISHED = "draft", "scheduled", "live", "closed", "published"
    STATUSES = [(DRAFT, "Draft"), (SCHEDULED, "Scheduled"), (LIVE, "Live"), (CLOSED, "Closed"),
                (PUBLISHED, "Results published")]  # EXM-07

    title = models.CharField(max_length=200)
    subject = models.ForeignKey("academics.Subject", on_delete=models.PROTECT, related_name="exams")
    term = models.ForeignKey("academics.Term", null=True, blank=True, on_delete=models.SET_NULL, related_name="exams")  # ADM-04
    classes = models.ManyToManyField("academics.SchoolClass", blank=True, related_name="exams")
    students = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="individual_exams")  # EXM-06
    start_at = models.DateTimeField(null=True, blank=True)  # BR-09: entered manually by an admin
    end_at = models.DateTimeField(null=True, blank=True)  # a teacher's draft has no dates until an admin sets them
    duration_minutes = models.PositiveIntegerField(default=60)
    pass_mark_percent = models.FloatField(default=30)
    rules_text = models.TextField(blank=True)
    shuffle_questions = models.BooleanField(default=True)
    shuffle_options = models.BooleanField(default=True)
    allow_skip = models.BooleanField(default=False)
    late_entry_minutes = models.PositiveIntegerField(null=True, blank=True)  # null = school default
    time_warnings = models.JSONField(default=list)  # minutes before end; [] = default [10, 5, 1]
    partial_marks = models.BooleanField(default=True)  # EXM-05
    allow_review = models.BooleanField(default=True)  # students may open the full exam (her answers, the key, the explanations) once her result is out; an admin switches it
    negative_marking = models.BooleanField(default=False)
    negative_fraction = models.FloatField(default=0.25)  # share of a question's marks deducted when wrong
    status = models.CharField(max_length=10, choices=STATUSES, default=DRAFT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    # When a teacher hands a finished paper to the administrators for scheduling (a draft stays a draft until an admin
    # sets the date and classes). Kept after scheduling so the admin console can still show who submitted what and when.
    submitted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name="+")
    # An administrator can send a submitted paper back to the teacher who handed it in, with a reason. The exam is then an ordinary
    # draft again (submitted_at is cleared). The reason shows to the teacher as a pop-up until she closes it (return_seen_at) and stays
    # on the exam until she submits it again, which clears all five.
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    returned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="returned_exams")
    return_reason = models.TextField(blank=True, default="")
    return_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["start_at"]

    def question_stats(self):
        """(number of counted questions, total marks) from ONE light query that reads only the marks, not every question's whole
        JSON (answers, explanations, images). The exam list and every START use this."""
        marks = list(self.questions.filter(voided=False).values_list("payload__marks", flat=True))
        return len(marks), round(sum(m or 0 for m in marks), 2)

    @property
    def total_marks(self):
        return self.question_stats()[1]


class ExamQuestion(models.Model):
    """EXM-01 / QB-11: each exam keeps its own copy of every question it uses."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="questions")
    position = models.PositiveIntegerField()
    source = models.ForeignKey("questions.Question", null=True, on_delete=models.SET_NULL)
    payload = models.JSONField()  # qtype, prompt, content, answer, marks, explanation, topic, difficulty
    voided = models.BooleanField(default=False)  # EXM-08
    void_reason = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["position"]
        unique_together = [("exam", "position")]


class BuilderDraft(models.Model):
    """A teacher's work-in-progress in the exam builder: the questions she has typed but not saved yet, the order of her
    unsaved selection, and where she was (tab / step). One row per teacher per exam, stored on the server so she can log
    out, change phone or computer, and carry on exactly where she stopped. Private to her: nobody else reads it."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="builder_drafts")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    data = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("exam", "user")]


class SavedQuestion(models.Model):
    """A question a student bookmarked from her exam review. It keeps a private COPY (question, correct answer, explanation), taken
    from the review only after her results were published, so it can never show an answer earlier than she was allowed to see it."""

    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_questions")
    attempt = models.ForeignKey("exams.Attempt", on_delete=models.CASCADE, related_name="+")
    number = models.PositiveSmallIntegerField()  # the question's number in that exam
    snapshot = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("student", "attempt", "number")]
        ordering = ["-created_at", "-id"]


class Attempt(models.Model):
    IN_PROGRESS, SUBMITTED, AUTO_SUBMITTED = "in_progress", "submitted", "auto_submitted"

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="attempts")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attempts")
    attempt_no = models.PositiveSmallIntegerField(default=1)  # BR-04: >1 only through an admin retake grant
    status = models.CharField(max_length=14, default=IN_PROGRESS)
    started_at = models.DateTimeField()
    deadline_at = models.DateTimeField()  # BR-03: the server owns the clock
    device_id = models.CharField(max_length=64, blank=True, default="")  # the browser that is writing this attempt (see proctoring.services.login_blocked)
    device_seen_at = models.DateTimeField(null=True, blank=True)  # last time that browser talked to the attempt
    submitted_at = models.DateTimeField(null=True, blank=True)
    order = models.JSONField(default=list)  # ExamQuestion ids in this student's order
    current_index = models.PositiveIntegerField(default=0)
    # When the CURRENT question was first shown to her (server time). null = not shown yet (the clock starts on the first unlocked view).
    question_started_at = models.DateTimeField(null=True, blank=True)
    seed = models.PositiveIntegerField(default=0)
    # Lock for leaving the exam screen too often, or by hand from the live monitor. "" = not locked.
    # The exam clock keeps running while locked. An unlock moves `leaves_forgiven` up to the number of exits so far,
    # so the student starts again with a full allowance instead of being locked by her very next exit.
    LOCK_LEAVES, LOCK_MANUAL = "leaves", "manual"
    screen_lock = models.CharField(max_length=10, blank=True, default="")  # "" | leaves | manual
    screen_locked_at = models.DateTimeField(null=True, blank=True)
    leaves_forgiven = models.PositiveIntegerField(default=0)
    # Set when an administrator ended this attempt by hand (services.end_attempt). null = it ended by itself (she submitted or time ran out).
    ended_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    end_reason = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["exam", "student", "attempt_no"], name="one_attempt_per_no")]
        indexes = [models.Index(fields=["exam", "status"])]


class Answer(models.Model):
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name="answers")
    exam_question = models.ForeignKey(ExamQuestion, on_delete=models.CASCADE, related_name="answers")
    response = models.JSONField(null=True, blank=True)
    skipped = models.BooleanField(default=False)
    timed_out = models.BooleanField(default=False)  # the question's time limit ran out (the answer, if any, was too late)
    answered_at = models.DateTimeField(auto_now_add=True)
    marks_awarded = models.FloatField(null=True, blank=True)

    class Meta:
        unique_together = [("attempt", "exam_question")]


class Result(models.Model):
    attempt = models.OneToOneField(Attempt, on_delete=models.CASCADE, related_name="result")
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="results")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="results")
    score = models.FloatField()
    total = models.FloatField()
    percent = models.FloatField()
    grade = models.CharField(max_length=2)
    points = models.PositiveSmallIntegerField()
    passed = models.BooleanField(default=False)
    scale_snapshot = models.JSONField()  # GRD-04: the scale in force when marked
    time_taken_seconds = models.PositiveIntegerField(default=0)
    topic_stats = models.JSONField(default=dict)  # {topic: [earned, possible]}  (RES-04)
    # A correction of the answer key re-marks the result (exams/corrections.py). `revision` counts those re-marks (0 = never corrected),
    # `previous` is what the result was BEFORE the latest one, so the student can be shown "updated: 50% -> 80%".
    revision = models.PositiveSmallIntegerField(default=0)
    corrected_at = models.DateTimeField(null=True, blank=True)
    previous = models.JSONField(null=True, blank=True)  # {score, total, percent, grade, passed}

    class Meta:
        indexes = [models.Index(fields=["exam", "-score"])]


class ExamGrant(models.Model):
    """EXM-09: extra time or a retake for one student, always audited with a reason."""

    EXTRA_TIME, RETAKE = "extra_time", "retake"
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="grants")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=10)
    extra_minutes = models.PositiveIntegerField(default=0)
    reason = models.CharField(max_length=300)
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class AttemptEvent(models.Model):
    """EDAY-11: integrity info flags (tab switches). Information only, never an accusation."""

    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=20)  # left_screen | returned
    at = models.DateTimeField(auto_now_add=True)


class ExamCorrection(models.Model):
    """A fix to one question's answer key (or marks) AFTER the exam closed, with everything it changed (exams/corrections.py).
    Kept forever: who corrected what, why, what it was before and after, and how many results moved."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="corrections")
    exam_question = models.ForeignKey(ExamQuestion, null=True, on_delete=models.SET_NULL, related_name="corrections")
    number = models.PositiveIntegerField()  # the question's number in the paper
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    reason = models.CharField(max_length=300)
    before = models.JSONField(default=dict)  # {answer, content, marks, explanation} as it was
    after = models.JSONField(default=dict)   # ... and as it is now
    students = models.PositiveIntegerField(default=0)  # results re-marked
    changed = models.PositiveIntegerField(default=0)   # results whose score, grade or pass/fail moved
    up = models.PositiveIntegerField(default=0)
    down = models.PositiveIntegerField(default=0)
    notified = models.PositiveIntegerField(default=0)
    bank_updated = models.BooleanField(default=False)  # the question in the question bank was fixed too
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class ResultChange(models.Model):
    """One student's result before and after one correction."""

    correction = models.ForeignKey(ExamCorrection, on_delete=models.CASCADE, related_name="changes")
    result = models.ForeignKey(Result, on_delete=models.CASCADE, related_name="changes")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    before = models.JSONField()  # {score, total, percent, grade, passed}
    after = models.JSONField()

    class Meta:
        ordering = ["-id"]



class PaperSheet(models.Model):
    """The printed home package of ONE student for ONE exam (exams/paper.py), for students without a smartphone or internet.
    `code` is printed on every page and as a barcode. Scanning it marks the sheet RECEIVED (she counts as submitted); then an
    administrator keys in her answers, which become an ordinary Attempt that is auto-marked like any other (`attempt`)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="paper_sheets")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="paper_sheets")
    code = models.CharField(max_length=12, unique=True)  # 8 characters from an alphabet without look-alikes (0/O, 1/I/L)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    received_at = models.DateTimeField(null=True, blank=True)  # the barcode was scanned: her sheet is back
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    attempt = models.OneToOneField(Attempt, null=True, blank=True, on_delete=models.SET_NULL, related_name="paper_sheet")  # set once her answers are keyed in
    entered_at = models.DateTimeField(null=True, blank=True)
    entered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        unique_together = [("exam", "student")]
        ordering = ["student__first_name", "student__last_name", "id"]
