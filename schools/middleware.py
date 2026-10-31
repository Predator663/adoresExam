"""Chooses the school (PostgreSQL schema) for every request.

Order of the clues:
  1. X-School header          the web app sends its own address (location.hostname); one static build serves every school.
  2. X-Device-Token (SMS)     /api/sms/* from the Android phone: the token starts with the school's schema name ("amani.abc..."),
                              because the phone app cannot send an X-School header.
  3. admin cookie / ?school=  only for /django-admin/ and /controlroom/ pages opened in a browser:  /django-admin/?school=exams.school.ac.tz
                              (an empty  ?school=  goes back to the platform). It is remembered for 8 hours.
  4. the address the request came to (Host), when it is registered as a school's Domain.
  5. LEGACY_SCHOOL_SCHEMA     /api/* from an old web app / old phone that sends no clue (only while you set this variable).
  6. otherwise the PUBLIC schema = the platform itself (school list, platform admin, health check).

An address that is named but not registered gets 404 "unknown_school"; a suspended school gets 403 "school_suspended"."""
import re

from django.conf import settings
from django.db import connection
from django.http import HttpResponse, JsonResponse
from django_tenants.middleware.main import TenantMainMiddleware
from django_tenants.utils import get_public_schema_name, get_tenant_domain_model, get_tenant_model

HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")
SCHEMA_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
ADMIN_PREFIXES = ("/django-admin/", "/controlroom/")
ADMIN_COOKIE = "school_admin"
ADMIN_COOKIE_AGE = 8 * 3600


def clean_host(value):
    """'https://Exams.School.ac.tz:443/x' -> 'exams.school.ac.tz'. Anything that is not a plain host name -> ''."""
    v = str(value or "").strip().lower()
    v = re.sub(r"^[a-z][a-z0-9+.-]*://", "", v)
    v = re.split(r"[/?#]", v, maxsplit=1)[0]
    v = re.sub(r":\d+$", "", v).rstrip(".")
    return v if HOST_RE.match(v) else ""


def schema_from_device_token(token):
    """'amani.Xy12...' -> 'amani'. An old token without a school part -> ''."""
    head, dot, _ = str(token or "").partition(".")
    return head if dot and SCHEMA_RE.match(head) else ""


class _Deny(Exception):
    def __init__(self, status, code, detail):
        self.status, self.code, self.detail = status, code, detail


def _by_domain(host):
    if not host:
        return None
    d = get_tenant_domain_model().objects.select_related("tenant").filter(domain=host).first()
    return d.tenant if d else None


def _by_schema(schema):
    return get_tenant_model().objects.filter(schema_name=schema).first() if schema else None


class SchoolMiddleware(TenantMainMiddleware):
    def process_request(self, request):
        connection.set_schema_to_public()  # a persistent connection still points at the previous request's school
        request._school_cookie = None  # None = leave it, "" = remove it, anything else = remember it
        public = get_public_schema_name()
        try:
            tenant = self._resolve(request)
            if tenant is not None and not tenant.is_active:
                raise _Deny(403, "school_suspended", "This school's access is suspended. Please contact the administrator.")
        except _Deny as d:
            return self._deny(request, d.status, d.code, d.detail)
        if tenant is None:
            tenant = get_tenant_model()(schema_name=public, name="Platform")
        request.tenant = tenant
        connection.set_tenant(tenant)
        if tenant.schema_name == public:
            request.urlconf = settings.PUBLIC_SCHEMA_URLCONF

    def process_response(self, request, response):
        value = getattr(request, "_school_cookie", None)
        if value is not None:
            if value:
                response.set_cookie(ADMIN_COOKIE, value, max_age=ADMIN_COOKIE_AGE, httponly=True, secure=not settings.DEBUG, samesite="Lax")
            else:
                response.delete_cookie(ADMIN_COOKIE)
        return response

    # ------------------------------------------------------------------
    def _resolve(self, request):
        path = request.path_info
        meta = request.META

        raw = meta.get("HTTP_X_SCHOOL", "")
        if raw:
            tenant = _by_domain(clean_host(raw))
            if tenant is None:
                raise _Deny(404, "unknown_school", "This school is not registered on this system.")
            tenant.domain_url = clean_host(raw)
            return tenant

        if path.startswith("/api/sms/"):
            schema = schema_from_device_token(meta.get("HTTP_X_DEVICE_TOKEN", ""))
            if schema:
                tenant = _by_schema(schema)
                if tenant is None:
                    raise _Deny(404, "unknown_school", "This phone belongs to a school that is not registered on this system.")
                return tenant

        if path.startswith(ADMIN_PREFIXES):
            picked = request.GET.get("school") if request.method == "GET" else None
            if picked is not None:
                host = clean_host(picked)
                if not host:  # ?school=  -> back to the platform
                    request._school_cookie = ""
                else:
                    tenant = _by_domain(host)
                    if tenant is None:
                        raise _Deny(404, "unknown_school", "This school is not registered on this system.")
                    request._school_cookie = host
                    return tenant
            else:
                host = clean_host(request.COOKIES.get(ADMIN_COOKIE, ""))
                if host:
                    tenant = _by_domain(host)
                    if tenant is not None:
                        return tenant
                    request._school_cookie = ""  # the school's address was removed: forget it

        host = clean_host(request.get_host())
        tenant = _by_domain(host)
        if tenant is not None:
            tenant.domain_url = host
            return tenant

        legacy = getattr(settings, "LEGACY_SCHOOL_SCHEMA", "")
        if legacy and path.startswith("/api/"):
            return _by_schema(legacy)
        return None

    @staticmethod
    def _deny(request, status, code, detail):
        if request.path_info.startswith("/api/"):
            return JsonResponse({"detail": detail, "code": code}, status=status)
        return HttpResponse(detail, status=status, content_type="text/plain; charset=utf-8")
