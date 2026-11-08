import io

from django.core.files.base import ContentFile
from django.db.models import Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action, api_view, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from academics.models import TeacherAssignment
from accounts.permissions import IsAdminRole, IsStaffUser
from core.models import audit
from .models import Question, QuestionImage, QuestionVersion
from .validation import clean_prompt, validate_question


class QuestionSerializer(serializers.ModelSerializer):
    used_in_exam = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = ["id", "subject", "form_level", "topic", "subtopic", "difficulty", "marks", "language", "qtype",
                  "prompt", "content", "answer", "explanation", "status", "practice_eligible", "version",
                  "created_by", "created_by_name", "is_mine", "can_edit", "updated_at", "used_in_exam"]
        read_only_fields = ["status", "version", "created_by", "updated_at"]

    def get_used_in_exam(self, obj):
        return obj.examquestion_set.exists()

    def _user(self):
        req = self.context.get("request")  # the exam builder's picker serialises without a request
        return getattr(req, "user", None)

    def get_created_by_name(self, obj):
        u = obj.created_by
        return (u.get_full_name() or u.username) if u else ""

    def get_is_mine(self, obj):
        u = self._user()
        return bool(u and obj.created_by_id == u.pk)

    def get_can_edit(self, obj):
        u = self._user()
        return bool(u and _can_modify(u, obj))

    def validate(self, data):
        inst = self.instance
        qtype = data.get("qtype", inst.qtype if inst else None)
        content = data.get("content", inst.content if inst else {})
        answer = data.get("answer", inst.answer if inst else {})
        data["content"], data["answer"] = validate_question(qtype, content, answer)
        data["prompt"] = clean_prompt(data.get("prompt", inst.prompt if inst else ""))
        if "explanation" in data:
            data["explanation"] = clean_prompt(data["explanation"]) if data["explanation"].strip() else ""
        if data.get("marks", 1) <= 0:
            raise serializers.ValidationError({"marks": "Marks must be above zero."})
        return data


def _can_write_subject(user, subject_id):
    if user.is_admin_role:
        return True
    return TeacherAssignment.objects.filter(teacher=user, subject_id=subject_id).exists()  # QB-10


def _can_modify(user, question):
    """Edit / delete / submit: an admin may touch any question; a teacher only the ones she wrote herself,
    and only while she is still assigned to the subject."""
    if user.is_admin_role:
        return True
    return question.created_by_id == user.pk and _can_write_subject(user, question.subject_id)


class QuestionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStaffUser]
    serializer_class = QuestionSerializer

    def get_queryset(self):
        u = self.request.user
        p = self.request.query_params
        qs = Question.objects.select_related("created_by")
        if not u.is_admin_role:
            # A teacher only ever sees the subjects she is assigned to ...
            qs = qs.filter(subject_id__in=TeacherAssignment.objects.filter(teacher=u).values("subject_id"))
            # ... and, of her colleagues' questions, only the approved ones (their drafts stay private).
            # `ids` is the exam builder re-loading its own saved paper, so it is not narrowed further.
            if not p.get("ids"):
                qs = qs.filter(Q(created_by=u) | Q(status=Question.APPROVED))
        if p.get("scope") == "mine":
            qs = qs.filter(created_by=u)
        elif p.get("scope") == "others":  # exclude() keeps questions whose author account was deleted
            qs = qs.exclude(created_by=u)
        for f in ("subject", "topic", "difficulty", "qtype", "status", "form_level"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        if p.get("q"):
            qs = qs.filter(Q(prompt__icontains=p["q"]) | Q(topic__icontains=p["q"]))
        if p.get("ids"):  # the exam builder loads the questions it already has by id
            ids = [int(x) for x in p["ids"].split(",") if x.strip().isdigit()]
            qs = qs.filter(pk__in=ids)
        return qs

    def _snapshot(self, q):
        return {f: getattr(q, f) for f in ("subject_id", "form_level", "topic", "subtopic", "difficulty", "marks",
                                           "language", "qtype", "prompt", "content", "answer", "explanation")}

    def perform_create(self, serializer):
        subject = serializer.validated_data["subject"]
        if not _can_write_subject(self.request.user, subject.pk):
            raise PermissionDenied("You can only write questions for your assigned subjects.")
        # A question a teacher submits is approved straight away, so it can go into an exam at once.
        submit_now = str(self.request.data.get("submit", "")).lower() in ("1", "true", "yes")
        q = serializer.save(created_by=self.request.user, status=Question.APPROVED if submit_now else Question.DRAFT)
        QuestionVersion.objects.create(question=q, version=1, snapshot=self._snapshot(q), edited_by=self.request.user)

    def perform_update(self, serializer):
        q = serializer.instance
        new_subject = serializer.validated_data.get("subject", q.subject)
        if not _can_modify(self.request.user, q):
            raise PermissionDenied("You can only edit questions you created yourself.")
        if not _can_write_subject(self.request.user, new_subject.pk):
            raise PermissionDenied("You can only edit questions for your assigned subjects.")
        q = serializer.save(version=q.version + 1)  # an edited approved question stays approved
        QuestionVersion.objects.create(question=q, version=q.version, snapshot=self._snapshot(q), edited_by=self.request.user)

    def perform_destroy(self, instance):
        if not _can_modify(self.request.user, instance):
            raise PermissionDenied("You can only delete questions you created yourself.")
        if instance.examquestion_set.exists():  # QB-12: used questions are archived, never deleted
            instance.status = Question.ARCHIVED
            instance.save(update_fields=["status"])
        else:
            instance.delete()

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        q = self.get_object()
        if not _can_modify(request.user, q):
            raise PermissionDenied("You can only submit questions you created yourself.")
        q.status = Question.APPROVED  # no waiting for an administrator: it is visible to the exam builder now
        q.save(update_fields=["status"])
        return Response({"status": q.status})

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def approve(self, request, pk=None):
        q = self.get_object()
        q.status = Question.APPROVED
        q.save(update_fields=["status"])
        audit(request.user, "question.approve", q.pk)
        return Response({"status": q.status})

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def reject(self, request, pk=None):
        q = self.get_object()
        q.status = Question.DRAFT
        q.save(update_fields=["status"])
        audit(request.user, "question.reject", q.pk, reason=request.data.get("reason", ""))
        return Response({"status": q.status})


@api_view(["POST"])
@permission_classes([IsStaffUser])
@parser_classes([MultiPartParser])
def upload_image(request):
    """QB-02/03: question images only (not question files, BR-02). Compressed + resized."""
    from core.images import BadImage, open_image

    f, alt = request.FILES.get("image"), (request.data.get("alt_text") or "").strip()
    if not f:
        return Response({"detail": "Please choose an image."}, status=400)
    if not alt:
        return Response({"detail": "Please add a short description of the image."}, status=400)
    if f.size > 10 * 1024 * 1024:
        return Response({"detail": "Image is too large (max 10 MB)."}, status=400)
    try:
        img = open_image(f, invalid="That file is not a valid JPG, PNG or WebP image.")
    except BadImage as e:
        return Response({"detail": str(e)}, status=400)
    if img.format not in ("JPEG", "PNG", "WEBP"):
        return Response({"detail": "Only JPG, PNG and WebP images are allowed."}, status=400)
    img.thumbnail((1280, 1280))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=80)
    obj = QuestionImage(alt_text=alt[:300], uploaded_by=request.user)
    import uuid  # unguessable file name: /media/ is served without a login, so the address itself is the secret
    obj.image.save(f"{uuid.uuid4().hex}.webp", ContentFile(buf.getvalue()), save=True)
    return Response({"id": obj.pk, "url": obj.image.url, "alt_text": obj.alt_text}, status=201)
