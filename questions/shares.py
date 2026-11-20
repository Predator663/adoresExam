"""Teachers only see and use their OWN questions. To use a colleague's question she sends a request; the owner approves or denies it.
An approved question can go into the requester's exam papers (and shows under "Shared with me" in the exam builder). The owner can
withdraw it later. Administrators are not limited: they can use any question and can decide any request.

Endpoints (all staff only), see questions/urls.py:
  GET  /api/question-shares/?box=incoming|outgoing[&status=..][&page=..]   requests to me / requests I sent (admins: box=all)
  POST /api/question-shares/                {question, note?}               ask the owner
  POST /api/question-shares/<id>/approve|deny|revoke|cancel/  {reply?}      the owner decides (revoke: take back an approval); the requester cancels
  GET  /api/question-shares/counts/                                         numbers for the badges
  GET  /api/question-shares/browse/?subject=&q=&topic=&difficulty=&page=    colleagues' approved questions in MY subjects, answers hidden
"""
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from academics.models import TeacherAssignment
from accounts.permissions import IsStaffUser
from core.models import audit
from core.pagination import page_params
from .models import Question, QuestionShare

MAX_OPEN = 60  # one teacher cannot have more than this many requests waiting at once


def shared_ids(user):
    """Ids of other teachers' questions that this teacher may use (approved and not withdrawn)."""
    return set(QuestionShare.objects.filter(requester=user, status=QuestionShare.APPROVED).values_list("question_id", flat=True))


def usable(user, qs):
    """Narrow a Question queryset to what this person may put into an exam: everything for an administrator; for a teacher her own
    questions and the ones shared with her."""
    if user.is_admin_role:
        return qs
    return qs.filter(Q(created_by=user) | Q(pk__in=shared_ids(user)))


def blocked(user, question_ids, exam=None):
    """The ids among `question_ids` that this teacher may NOT use (empty for an administrator). Questions already in this exam are
    never blocked: they were allowed when they were added (or the exam was built by an administrator)."""
    if user.is_admin_role:
        return []
    ids = set(question_ids)
    ok = set(Question.objects.filter(pk__in=ids, created_by=user).values_list("pk", flat=True)) | (shared_ids(user) & ids)
    if exam is not None:
        ok |= set(exam.questions.filter(source_id__in=ids).values_list("source_id", flat=True))
    return sorted(ids - ok)


def _name(u):
    return (u.get_full_name() or u.username) if u else ""


def status_map(user, question_ids):
    """{question id: {status, id, reply}} of THIS teacher's own requests, for labelling cards."""
    return {s.question_id: {"status": s.status, "id": s.pk, "reply": s.reply, "owner": _name(s.owner)}
            for s in QuestionShare.objects.filter(requester=user, question_id__in=list(question_ids)).select_related("owner")}


def hidden(data):
    """A question as a stranger may see it: the text and options, never the answer or the explanation."""
    d = dict(data)
    d["answer"], d["explanation"] = {}, ""
    return d


def _question_dict(q, request, reveal):
    from .views import QuestionSerializer  # late import: views imports this module
    d = QuestionSerializer(q, context={"request": request}).data
    return dict(d) if reveal else hidden(d)


def _row(s, request, viewer):
    reveal = s.owner_id == viewer.pk or viewer.is_admin_role or s.status == QuestionShare.APPROVED
    q = s.question
    return {"id": s.pk, "status": s.status, "note": s.note, "reply": s.reply, "requested_at": s.requested_at, "decided_at": s.decided_at,
            "requester": _name(s.requester), "requester_id": s.requester_id, "owner": _name(s.owner), "owner_id": s.owner_id,
            "subject_name": q.subject.name, "question": _question_dict(q, request, reveal)}


def _notify(users, title, body, key):
    try:
        from notifications.services import notify
        notify(users, "question_share", title, body, key=key, data={"url": "/staff/questions/?tab=requests"})
    except Exception:  # a notification problem must never stop the request itself
        pass


class QuestionShareViewSet(viewsets.ViewSet):
    permission_classes = [IsStaffUser]

    # ---- reading
    def list(self, request):
        u, p = request.user, request.query_params
        box = p.get("box", "incoming")
        qs = QuestionShare.objects.select_related("question__subject", "question__created_by", "requester", "owner")
        if box == "all" and u.is_admin_role:
            pass
        elif box == "outgoing":
            qs = qs.filter(requester=u)
        else:
            qs = qs.filter(owner=u)
        if p.get("status") in dict(QuestionShare.STATUSES):
            qs = qs.filter(status=p["status"])
        page, size = page_params(request, 10)
        count = qs.count()
        pages = max(1, -(-count // size))
        page = min(page, pages)
        rows = list(qs[(page - 1) * size: page * size])
        return Response({"count": count, "page": page, "pages": pages, "page_size": size, "results": [_row(s, request, u) for s in rows]})

    @action(detail=False, methods=["get"])
    def counts(self, request):
        u = request.user
        return Response({"incoming_pending": QuestionShare.objects.filter(owner=u, status=QuestionShare.PENDING).count(),
                         "outgoing_pending": QuestionShare.objects.filter(requester=u, status=QuestionShare.PENDING).count(),
                         "shared_with_me": len(shared_ids(u))})

    @action(detail=False, methods=["get"])
    def browse(self, request):
        """Colleagues' APPROVED questions in the subjects I teach (never their drafts), answers hidden, each with the state of my request."""
        u, p = request.user, request.query_params
        mine = TeacherAssignment.objects.filter(teacher=u).values("subject_id")
        qs = Question.objects.filter(status=Question.APPROVED, subject_id__in=mine, created_by__isnull=False).exclude(created_by=u).select_related("created_by", "subject")
        if u.is_admin_role:
            qs = Question.objects.filter(status=Question.APPROVED).exclude(created_by=u).select_related("created_by", "subject")
        for f in ("subject", "topic", "difficulty", "qtype", "form_level"):
            if p.get(f):
                qs = qs.filter(**{f: p[f]})
        if p.get("q"):
            qs = qs.filter(Q(prompt__icontains=p["q"]) | Q(topic__icontains=p["q"]))
        if p.get("state") in ("none", "pending", "approved", "denied"):
            have = QuestionShare.objects.filter(requester=u)
            if p["state"] == "none":
                qs = qs.exclude(pk__in=have.filter(status__in=[QuestionShare.PENDING, QuestionShare.APPROVED]).values("question_id"))
            else:
                qs = qs.filter(pk__in=have.filter(status=p["state"]).values("question_id"))
        qs = qs.order_by("-created_at", "-id")
        page, size = page_params(request, 10)
        count = qs.count()
        pages = max(1, -(-count // size))
        page = min(page, pages)
        rows = list(qs[(page - 1) * size: page * size])
        st = status_map(u, [q.pk for q in rows])
        out = []
        for q in rows:
            d = _question_dict(q, request, reveal=u.is_admin_role or st.get(q.pk, {}).get("status") == QuestionShare.APPROVED)
            d["share"] = st.get(q.pk)
            out.append(d)
        subjects = sorted({(s.subject_id, s.subject.name) for s in TeacherAssignment.objects.filter(teacher=u).select_related("subject")})
        return Response({"count": count, "page": page, "pages": pages, "page_size": size, "results": out,
                         "subjects": [{"id": i, "name": n} for i, n in subjects]})

    # ---- asking
    def create(self, request):
        u = request.user
        if u.is_admin_role:
            raise ValidationError({"detail": "Administrators can use any question without asking."})
        try:
            q = Question.objects.select_related("created_by").get(pk=int(request.data.get("question")))
        except (TypeError, ValueError, Question.DoesNotExist):
            raise ValidationError({"detail": "Choose a question to request."})
        if q.created_by_id == u.pk:
            raise ValidationError({"detail": "This is your own question: you can use it already."})
        if q.status != Question.APPROVED or q.created_by_id is None:
            raise ValidationError({"detail": "Only a colleague's approved questions can be requested."})
        if not TeacherAssignment.objects.filter(teacher=u, subject_id=q.subject_id).exists():
            raise PermissionDenied("You can only request questions in the subjects you teach.")
        note = str(request.data.get("note") or "").strip()[:300]
        if QuestionShare.objects.filter(requester=u, status=QuestionShare.PENDING).count() >= MAX_OPEN:
            raise ValidationError({"detail": f"You already have {MAX_OPEN} requests waiting. Wait for answers before asking for more."})
        s = QuestionShare.objects.filter(question=q, requester=u).first()
        if s and s.status == QuestionShare.APPROVED:
            raise ValidationError({"detail": "You already have permission to use this question."})
        if s and s.status == QuestionShare.PENDING:
            raise ValidationError({"detail": f"You already asked {_name(q.created_by)}. Please wait for the answer."})
        if s:  # denied, withdrawn or cancelled before: ask again
            s.status, s.note, s.reply, s.decided_at, s.owner = QuestionShare.PENDING, note, "", None, q.created_by
            s.requested_at = timezone.now()
            s.save()
        else:
            s = QuestionShare.objects.create(question=q, requester=u, owner=q.created_by, note=note)
        audit(u, "question.share.request", q.pk, owner=q.created_by_id)
        _notify([q.created_by], f"{_name(u)} asks to use your question", (note or "Open Questions > Requests to answer."), key=f"qshare:{s.pk}:{int(s.requested_at.timestamp())}")
        return Response(_row(QuestionShare.objects.select_related("question__subject", "question__created_by", "requester", "owner").get(pk=s.pk), request, u), status=201)

    # ---- deciding
    def _mine_to_decide(self, request, pk):
        try:
            s = QuestionShare.objects.select_related("question__subject", "question__created_by", "requester", "owner").get(pk=pk)
        except QuestionShare.DoesNotExist:
            raise ValidationError({"detail": "This request no longer exists."})
        if s.owner_id != request.user.pk and not request.user.is_admin_role:
            raise PermissionDenied("Only the teacher who wrote the question can answer this request.")
        return s

    def _decide(self, request, pk, allowed_from, to, verb, title):
        s = self._mine_to_decide(request, pk)
        if s.status not in allowed_from:
            raise ValidationError({"detail": f"This request is already {s.get_status_display().lower()}."})
        s.status, s.reply, s.decided_at = to, str(request.data.get("reply") or "").strip()[:300], timezone.now()
        s.save(update_fields=["status", "reply", "decided_at"])
        audit(request.user, f"question.share.{verb}", s.question_id, requester=s.requester_id)
        _notify([s.requester], f"{_name(s.owner)} {title}", s.reply or plain_prompt(s.question), key=f"qshare:{s.pk}:{verb}:{int(s.decided_at.timestamp())}")
        return Response(_row(s, request, request.user))

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, pk, (QuestionShare.PENDING, QuestionShare.DENIED, QuestionShare.REVOKED), QuestionShare.APPROVED, "approve", "approved your request to use a question")

    @action(detail=True, methods=["post"])
    def deny(self, request, pk=None):
        return self._decide(request, pk, (QuestionShare.PENDING,), QuestionShare.DENIED, "deny", "denied your request to use a question")

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        return self._decide(request, pk, (QuestionShare.APPROVED,), QuestionShare.REVOKED, "revoke", "withdrew permission to use a question")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        try:
            s = QuestionShare.objects.select_related("question__subject", "question__created_by", "requester", "owner").get(pk=pk, requester=request.user)
        except QuestionShare.DoesNotExist:
            raise ValidationError({"detail": "This request no longer exists."})
        if s.status != QuestionShare.PENDING:
            raise ValidationError({"detail": f"This request is already {s.get_status_display().lower()}."})
        s.status, s.decided_at = QuestionShare.CANCELLED, timezone.now()
        s.save(update_fields=["status", "decided_at"])
        return Response(_row(s, request, request.user))


def plain_prompt(q):
    import re
    return re.sub(r"<[^>]+>", " ", q.prompt or "").strip()[:120]
