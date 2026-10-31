"""CORS for many schools: the browser may call the API from any address that is registered as a school's Domain (and that school is active).
corsheaders asks this through its `check_request_enabled` signal when the address is not in CORS_ORIGINS."""
import time
from urllib.parse import urlsplit

from django_tenants.utils import get_public_schema_name, schema_context

from .middleware import clean_host

TTL = 30  # seconds; adding a domain in the admin clears it at once on that worker, the others notice within this time
_cache = {"at": 0.0, "hosts": frozenset()}


def forget(*args, **kwargs):
    _cache["at"] = 0.0


def allowed_hosts():
    now = time.monotonic()
    if now - _cache["at"] > TTL:
        try:
            from .models import Domain
            with schema_context(get_public_schema_name()):  # a persistent connection may still point at the previous school
                hosts = frozenset(Domain.objects.filter(tenant__is_active=True).values_list("domain", flat=True))
            _cache.update(at=now, hosts=hosts)
        except Exception:  # table missing (before migrate) or a database hiccup: keep what we had
            _cache["at"] = now - TTL + 5
    return _cache["hosts"]


def _check(sender, request, **kwargs):
    origin = request.headers.get("Origin", "")
    return clean_host(urlsplit(origin).netloc) in allowed_hosts()


def connect():
    from corsheaders.signals import check_request_enabled
    check_request_enabled.connect(_check, dispatch_uid="schools.cors.check")
