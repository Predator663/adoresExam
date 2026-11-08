"""Brute-force protection for the Django admin sign-in page (/django-admin/login/).

The app's own login (LoginView) has the account lock and the login limits, but the stock Django admin page has nothing, and it is
reachable by anyone. The owner / platform accounts that sign in there control maintenance mode and every school. This wraps the
page: every sign-in attempt (right or wrong) counts, per user name and per address, and too many get a plain "wait" answer.

  ADMIN_LOGIN_USER_LIMIT   tries per user name per 15 minutes   (default 10)
  ADMIN_LOGIN_IP_LIMIT     tries per address per minute         (default 30)
"""
import hashlib

from django.conf import settings
from django.contrib import admin
from django.core.cache import cache
from django.http import HttpResponse
from rest_framework.settings import api_settings

USER_WINDOW, IP_WINDOW = 15 * 60, 60


def _address(request):
    """The visitor's address, the same way the API login limit finds it (NUM_PROXIES proxies in front, so a made-up header cannot dodge it)."""
    remote = request.META.get("REMOTE_ADDR", "")
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    proxies = api_settings.NUM_PROXIES
    if not proxies or not forwarded:
        return remote
    addrs = [a.strip() for a in forwarded.split(",")]
    return addrs[-min(proxies, len(addrs))] or remote


def _hit(key, window):
    """Count one try; returns how many tries there have been in this window."""
    cache.add(key, 0, window)
    try:
        return cache.incr(key)
    except ValueError:  # the key expired between the two calls
        cache.set(key, 1, window)
        return 1


def guarded_admin_login(request, extra_context=None):
    if request.method == "POST":
        name = str(request.POST.get("username") or "").strip().lower()[:80]
        over_ip = _hit(f"adminlogin:ip:{_address(request)}", IP_WINDOW) > getattr(settings, "ADMIN_LOGIN_IP_LIMIT", 30)
        over_user = bool(name) and _hit(f"adminlogin:user:{hashlib.sha256(name.encode()).hexdigest()[:32]}", USER_WINDOW) > getattr(settings, "ADMIN_LOGIN_USER_LIMIT", 10)
        if over_ip or over_user:
            resp = HttpResponse("Too many sign-in attempts. Please wait a few minutes and try again.", status=429, content_type="text/plain; charset=utf-8")
            resp["Retry-After"] = str(USER_WINDOW if over_user else IP_WINDOW)
            return resp
    return admin.site.login(request, extra_context)
