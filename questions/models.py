from django.conf import settings
from django.db import models


class Question(models.Model):
    MCQ_SINGLE, MCQ_MULTI, TRUE_FALSE = "mcq_single", "mcq_multi", "true_false"
    MATCHING, FILL_BLANK, ORDERING = "matching", "fill_blank", "ordering"
    FILL_MULTI = "fill_multi"  # several blanks in one passage; typed, or dragged from a word bank
    TYPES = [(MCQ_SINGLE, "Multiple choice (one answer)"), (MCQ_MULTI, "Multiple choice (several answers)"),
             (TRUE_FALSE, "True or false"), (MATCHING, "Matching"), (FILL_BLANK, "Fill in the blank"),
             (FILL_MULTI, "Fill in the blanks (several)"), (ORDERING, "Ordering")]  # BR-01 / QB-01: every type is auto-markable
    DRAFT, SUBMITTED, APPROVED, ARCHIVED = "draft", "submitted", "approved", "archived"
    STATUSES = [(DRAFT, "Draft"), (SUBMITTED, "Submitted"), (APPROVED, "Approved"), (ARCHIVED, "Archived")]
    DIFFICULTIES = [("easy", "Easy"), ("medium", "Medium"), ("hard", "Hard")]

    subject = models.ForeignKey("academics.Subject", on_delete=models.PROTECT, related_name="questions")
    form_level = models.PositiveSmallIntegerField(default=1)
    topic = models.CharField(max_length=120, blank=True)
    subtopic = models.CharField(max_length=120, blank=True)
    difficulty = models.CharField(max_length=8, choices=DIFFICULTIES, default="medium")
    marks = models.FloatField(default=1)
    # Seconds a student may spend on this question in an exam (10 s .. 60 min). Empty = the default for its type (exams/timing.py).
    time_limit_seconds = models.PositiveIntegerField(null=True, blank=True)
    language = models.CharField(max_length=2, default="en")
    qtype = models.CharField(max_length=12, choices=TYPES)
    prompt = models.TextField()  # sanitised rich text
    content = models.JSONField(default=dict)  # options / left+right / items (no answers)
    answer = models.JSONField(default=dict)  # the correct answer(s); never sent to students
    explanation = models.TextField(blank=True)  # shown only in review after results (QB-06)
    status = models.CharField(max_length=10, choices=STATUSES, default=DRAFT)
    practice_eligible = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["subject", "topic", "difficulty", "status"])]


class QuestionVersion(models.Model):
    """QB-11: history. Exams keep their own copy, so editing never changes past results."""

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    snapshot = models.JSONField()
    edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)


class QuestionImage(models.Model):
    image = models.ImageField(upload_to="question_images/%Y/%m/")
    alt_text = models.CharField(max_length=300)  # QB-03: required for screen readers
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)


class QuestionShare(models.Model):
    """A teacher's request to use ANOTHER teacher's question in her exams. Teachers only see and use their own questions; this is
    the only way across: the owner approves or denies. An approved share lets the requester put that question into her own exam
    papers (the exam keeps its own copy, so a later edit by the owner does not change a paper already built). The owner can revoke it."""

    PENDING, APPROVED, DENIED, REVOKED, CANCELLED = "pending", "approved", "denied", "revoked", "cancelled"
    STATUSES = [(PENDING, "Waiting"), (APPROVED, "Approved"), (DENIED, "Denied"), (REVOKED, "Withdrawn"), (CANCELLED, "Cancelled")]

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="shares")
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="question_requests")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="question_requests_received")
    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING)
    note = models.CharField(max_length=300, blank=True)  # the requester's message to the owner
    reply = models.CharField(max_length=300, blank=True)  # the owner's message back
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-requested_at", "-id"]
        indexes = [models.Index(fields=["owner", "status"], name="qshare_owner_status_idx"), models.Index(fields=["requester", "status"], name="qshare_req_status_idx")]
        constraints = [models.UniqueConstraint(fields=["question", "requester"], name="qshare_one_per_pair")]
