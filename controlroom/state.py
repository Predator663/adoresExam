"""Maintenance state + owner rules. Kept tiny and defensive: if the table is missing (before migrate) the site is simply 'online'."""
import time

from django.conf import settings
from django.db import connection

_CACHE = {}  # schema name -> (time taken, value): each school has its own switch, and the platform has one for ALL schools
TTL = 3  # seconds; another worker notices a switch within this time


def owners():
    """Usernames allowed in during maintenance. CONTROLROOM_OWNERS='goose' (comma separated). Empty = any superuser."""
    v = getattr(settings, "CONTROLROOM_OWNERS", "") or ""
    if isinstance(v, str):
        v = v.split(",")
    return {x.strip().lower() for x in v if x.strip()}


def is_owner(user):
    if not (user and getattr(user, "is_authenticated", False) and user.is_active and user.is_superuser):
        return False
    allowed = owners()
    return not allowed or user.get_username().lower() in allowed


def exempt_prefixes():
    base = ["/django-admin/", "/controlroom/", "/static/", "/healthz", "/favicon.ico", "/api/site-status/"]
    return tuple(base + list(getattr(settings, "CONTROLROOM_EXEMPT_PREFIXES", [])))


def schema():
    return getattr(connection, "schema_name", None) or "public"


def _row():
    from .models import SiteControl
    row = SiteControl.objects.filter(pk=1).first()
    return (bool(row and row.maintenance), row.message if row else "", row.back_at if row else "")


def current(force=False):
    """(maintenance: bool, message: str, back_at: str). On when the PLATFORM switch (all schools) or this school's own switch is on."""
    key = schema()
    now = time.monotonic()
    hit = _CACHE.get(key)
    if not force and hit and now - hit[0] < TTL:
        return hit[1]
    try:
        own = _row()
        val = own
        if key != "public" and not own[0]:  # the platform switch (all schools) lives in the public schema
            from django_tenants.utils import schema_context
            with schema_context("public"):
                everyone = _row()
            val = everyone if everyone[0] else own
    except Exception:  # table missing / DB hiccup: never take the site down because of the switch itself
        val = (False, "", "")
    _CACHE[key] = (now, val)
    return val


def reset_cache():
    _CACHE.clear()
