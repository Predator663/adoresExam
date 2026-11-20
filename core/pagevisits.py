"""Which screens each student opens, and for how long (administrators read it under Staff > Page visits).

The web app sends small batches (POST /api/page-visits/) of {uid, path, ago, seconds}: the screen's address inside the app, how many
seconds ago she opened it, and how long it was visible. Nothing else leaves the phone: the query string, the #hash and anything typed are
dropped by the app AND again here, and numbers in an address become :id.

Rows older than VISIT_RETENTION_DAYS (default 90) are deleted automatically (at most once an hour, by whichever upload comes first)."""
import re
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .presence import parse_ua

MAX_BATCH = 60
MAX_SECONDS = 4 * 3600  # one stay is never longer than four hours (a tab left open); more is cut to this
MAX_AGE = timedelta(days=2)  # an upload may report stays from the last two days (phone offline); older ones are dropped

# route -> the name people know it by (the app's own screens; anything else is shown as its address)
SCREENS = {
    "/": "Home", "/exam/": "Exams", "/results/": "Results", "/result/": "Result", "/review/": "Review answers", "/practice/": "Practice",
    "/progress/": "Progress", "/leaderboard/": "Leaderboard", "/badges/": "Badges", "/saved/": "Saved questions", "/messages/": "Messages",
    "/notifications/": "Notifications", "/settings/": "Settings", "/change-password/": "Change password", "/install/": "Install the app",
    "/about/": "About", "/privacy/": "Privacy policy", "/terms/": "Terms of use", "/accessibility/": "Accessibility", "/login/": "Login",
}


def normalise(path):
    """"/results/?term=2#top" -> "/results/"; "/messages/123/" -> "/messages/:id/". "" if it is not an address inside the app."""
    p = str(path or "").split("?", 1)[0].split("#", 1)[0].strip()
    if not p.startswith("/") or p.startswith("//") or len(p) > 120 or re.search(r"[\x00-\x1f<>\\\s]", p):
        return ""
    p = re.sub(r"/\d+(?=/|$)", "/:id", p)
    if len(p) > 1 and not p.endswith("/"):
        p += "/"
    return p


def screen_name(path):
    path = re.sub(r"/:id(?=/|$)", "", path) or "/"  # "/messages/:id/" is the Messages screen
    if path != "/" and not path.endswith("/"):
        path += "/"
    return SCREENS.get(path) or path.strip("/").replace("-", " ").replace("/", " > ").capitalize()[:60] or "Home"


def _prune():
    from .models import PageVisit
    if cache.add("pagevisits:prune", 1, 3600):
        days = int(getattr(settings, "VISIT_RETENTION_DAYS", 90))
        PageVisit.objects.filter(entered_at__lt=timezone.now() - timedelta(days=days)).delete()


def record(request, items):
    """Store a student's batch. Returns how many new rows were written. Bad items are skipped, never an error."""
    from .models import PageVisit
    u, now = request.user, timezone.now()
    ua = parse_ua(request.META.get("HTTP_USER_AGENT", "")[:300])
    standalone = bool(request.data.get("standalone")) if hasattr(request.data, "get") else False
    rows, seen = [], set()
    for it in (items if isinstance(items, list) else [])[:MAX_BATCH]:
        if not isinstance(it, dict):
            continue
        uid = re.sub(r"[^A-Za-z0-9-]", "", str(it.get("uid") or ""))[:36]
        path = normalise(it.get("path"))
        try:
            ago, secs = max(0, int(float(it.get("ago", 0)))), max(0, int(float(it.get("seconds", 0))))
        except (TypeError, ValueError):
            continue
        if not uid or not path or uid in seen or timedelta(seconds=ago) > MAX_AGE:
            continue
        seen.add(uid)
        rows.append(PageVisit(user=u, uid=uid, path=path, screen=screen_name(path), entered_at=now - timedelta(seconds=ago),
                              seconds=min(secs, MAX_SECONDS), device_type=ua["device_type"], standalone=standalone))
    if rows:
        PageVisit.objects.bulk_create(rows, ignore_conflicts=True)  # (user, uid) is unique: a retried upload adds nothing
        _prune()
    return len(rows)
