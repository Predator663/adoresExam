"""Per-question time limits. Every question in an exam has one, so nobody can sit on a single question for the whole paper.

The limit is chosen by the teacher on the question (or per exam in the builder); a question that has none yet gets a sensible
default for its type. The SERVER owns the question clock (Attempt.question_started_at); the phone only shows a countdown."""

MIN_SECONDS, MAX_SECONDS = 10, 3600
ANSWER_GRACE = 6      # seconds: network delay allowed for the answer the phone sends at zero
EXPIRE_GRACE = 12     # seconds: after this the server moves a question on by itself (phone closed, JS stopped ...)

# seconds per question type: enough to read and answer carefully, not enough to wander off
_BASE = {"true_false": 45, "mcq_single": 60, "mcq_multi": 90, "fill_blank": 60, "matching": 120, "ordering": 90}


def default_limit(qtype, content=None, marks=1):
    """A sensible limit for a question that has none: by type, a little more for longer ones (several blanks, many pairs)."""
    content = content or {}
    if qtype == "fill_multi":
        n = len(content.get("blanks") or []) or 3
        secs = 30 + 20 * n
    elif qtype == "matching":
        secs = 30 + 20 * (len(content.get("left") or []) or 4)
    elif qtype == "ordering":
        secs = 30 + 12 * (len(content.get("items") or []) or 5)
    else:
        secs = _BASE.get(qtype, 90)
    try:
        if float(marks) > 2:
            secs += int((float(marks) - 2) * 15)  # worth more marks: a little longer
    except (TypeError, ValueError):
        pass
    return clamp(secs)


def clamp(secs):
    return max(MIN_SECONDS, min(MAX_SECONDS, int(secs)))


def clean_limit(value):
    """The teacher's number as a valid whole number of seconds, or None when it is empty. Raises ValueError when it is not allowed."""
    if value in (None, ""):
        return None
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        raise ValueError("The time limit must be a number of seconds.")
    if n < MIN_SECONDS or n > MAX_SECONDS:
        raise ValueError(f"The time limit must be between {MIN_SECONDS} seconds and {MAX_SECONDS // 60} minutes.")
    return n


def limit_for(payload):
    """The limit of one exam question (old exams made before this feature have no number: they get the default)."""
    n = payload.get("time_limit_seconds")
    if isinstance(n, (int, float)) and n >= MIN_SECONDS:
        return clamp(n)
    return default_limit(payload.get("qtype"), payload.get("content"), payload.get("marks", 1))
