"""Who has the app open right now, and on what device.

The web app sends a small heartbeat (POST /api/presence/) every 60 seconds while a tab is open and visible, for every role.
record() keeps the newest one per person in the Presence table (at most one write per person per 55 seconds, in a single query).
Nothing here is shown to students; the administrator's "Who is online" page reads it."""
import re
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

ONLINE_SECONDS = 150  # the app beats every 60 s, so two missed beats = gone
NEW_SESSION_AFTER = timedelta(minutes=5)

_BRANDS = [  # start of the model text -> make (only prefixes that are unambiguous)
    (r"^(SM-|GT-)", "Samsung"), (r"^TECNO", "Tecno"), (r"^Infinix", "Infinix"), (r"^itel", "itel"), (r"^(Redmi|POCO|Mi )", "Xiaomi"),
    (r"^CPH", "Oppo"), (r"^RMX", "Realme"), (r"^vivo", "Vivo"), (r"^(HUAWEI|HONOR)", "Huawei"), (r"^Pixel", "Google"), (r"^moto", "Motorola"),
    (r"^(Nokia|TA-)", "Nokia"), (r"^LM-", "LG"),
]


def _first(rx, s, grp=1):
    m = re.search(rx, s)
    return m.group(grp) if m else ""


def parse_ua(ua: str) -> dict:
    """Browser, system and kind of device from the User-Agent text. A best guess: phones hide some details."""
    ua = ua or ""
    out = {"browser": "", "browser_version": "", "os": "", "os_version": "", "device_type": "desktop", "device": ""}
    # system
    if "iPhone" in ua or "iPod" in ua:
        out.update(os="iOS", os_version=_first(r"OS (\d+[_\d]*)", ua).replace("_", "."), device_type="mobile", device="iPhone")
    elif "iPad" in ua:
        out.update(os="iPadOS", os_version=_first(r"OS (\d+[_\d]*)", ua).replace("_", "."), device_type="tablet", device="iPad")
    elif "Android" in ua:
        out.update(os="Android", os_version=_first(r"Android (\d+(?:\.\d+)?)", ua), device_type="mobile" if "Mobile" in ua else "tablet")
        model = _first(r"Android [\d.]+; ([^;)]+?)(?: Build|\)|;)", ua).strip()
        if model and model not in ("K", "Mobile", "U"):  # Chrome now hides the model as "K"
            out["device"] = _brand(model)
    elif "Windows" in ua:
        out.update(os="Windows", os_version={"10.0": "10/11", "6.3": "8.1", "6.1": "7"}.get(_first(r"Windows NT ([\d.]+)", ua), ""))
    elif "CrOS" in ua:
        out.update(os="ChromeOS")
    elif "Mac OS X" in ua or "Macintosh" in ua:
        out.update(os="macOS")
    elif "Linux" in ua:
        out.update(os="Linux")
    # browser (order matters: many browsers also say "Chrome" and "Safari")
    for name, rx in [("Edge", r"(?:Edg|EdgA|EdgiOS)/([\d.]+)"), ("Opera", r"(?:OPR|OPiOS)/([\d.]+)"), ("Samsung Internet", r"SamsungBrowser/([\d.]+)"),
                     ("UC Browser", r"UCBrowser/([\d.]+)"), ("Opera Mini", r"Opera Mini/([\d.]+)"), ("Firefox", r"(?:Firefox|FxiOS)/([\d.]+)"),
                     ("Facebook app", r"FBAV/([\d.]+)"), ("Instagram app", r"Instagram ([\d.]+)"), ("TikTok app", r"(?:musical_ly|BytedanceWebview)[^ ]*(?:_|/)([\d.]+)"),
                     ("Chrome", r"(?:Chrome|CriOS)/([\d.]+)"), ("Safari", r"Version/([\d.]+).*Safari")]:
        v = _first(rx, ua)
        if v:
            out["browser"], out["browser_version"] = name, v.split(".")[0]
            break
    if out["browser"] == "Chrome" and re.search(r"; wv\)", ua):
        out["browser"] = "In-app browser (WebView)"
    return out


def _brand(model: str) -> str:
    for rx, brand in _BRANDS:
        if re.match(rx, model, re.I):
            return model if model.lower().startswith(brand.lower()) else f"{brand} {model}"
    return model


def _clean(v, n):
    return re.sub(r"[\x00-\x1f<>]", "", str(v or "")).strip()[:n]


def record(request):
    """Remember that this person has the app open (called from the heartbeat). Never raises: presence must not break a page."""
    from .models import Presence
    from proctoring.services import client_ip
    u = request.user
    if not getattr(u, "pk", None) or not cache.add(f"presence:w:{u.pk}", 1, 55):
        return
    try:
        now = timezone.now()
        d = request.data if hasattr(request.data, "get") else {}
        ua = request.META.get("HTTP_USER_AGENT", "")[:300]
        info = parse_ua(ua)
        model = _clean(d.get("model"), 40)  # real model name from the browser's client hints (Chrome on Android)
        if model:
            info["device"] = _brand(model)
        if d.get("platform_version") and info["os"] == "Android":
            info["os_version"] = _clean(d.get("platform_version"), 10).split(".")[0]
        fields = dict(last_seen=now, ip=client_ip(request), user_agent=ua, screen=_clean(d.get("screen"), 14), connection=_clean(d.get("connection"), 10),
                      language=_clean(d.get("language"), 12), standalone=bool(d.get("standalone")), page=_clean(d.get("page"), 80), **info)
        # One UPDATE does it all (a new session starts when she was away 5 minutes or more); a row is created only the first time.
        from django.db.models import Case, F, When
        gone = now - NEW_SESSION_AFTER
        if not Presence.objects.filter(user=u).update(session_start=Case(When(last_seen__lt=gone, then=now), default=F("session_start")), **fields):
            Presence.objects.create(user=u, session_start=now, **fields)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("presence not recorded")
