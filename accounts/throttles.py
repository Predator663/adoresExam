"""Login rate limits.

The old limit was 20 logins a minute per internet address. A whole school shares ONE address, so with 200 students
logging in together only about 20 a minute got in and the rest were told "Too many tries". Two limits replace it:

  * per USER NAME (LOGIN_USER_THROTTLE_RATE, default 10/min): one account cannot be hammered, however many classmates log in.
    It also counts names that do not exist, so the answer never shows which names are real.
  * per ADDRESS (LOGIN_IP_THROTTLE_RATE, default 600/min): generous, because a school shares one address. It is only a flood guard;
    each login also costs real processor time (password hashing), so this is near what a small server can do anyway.

Wrong passwords are still limited by the account lock (5 wrong tries lock the account for 15 minutes, see LoginView).
The old LOGIN_THROTTLE_RATE setting still works as the address limit.
"""
import hashlib

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class _LoginThrottle(SimpleRateThrottle):
    rate_setting = ""

    def get_rate(self):
        return getattr(settings, self.rate_setting)  # read when the request arrives, so a settings change needs no restart of the class

    def identity(self, request):
        raise NotImplementedError

    def get_cache_key(self, request, view):
        ident = self.identity(request)
        return self.cache_format % {"scope": self.scope, "ident": ident} if ident else None


class LoginIPThrottle(_LoginThrottle):
    scope, rate_setting = "login_ip", "LOGIN_IP_THROTTLE_RATE"

    def identity(self, request):
        return self.get_ident(request)  # honours NUM_PROXIES, so a made-up X-Forwarded-For cannot dodge it


class LoginUserThrottle(_LoginThrottle):
    scope, rate_setting = "login_user", "LOGIN_USER_THROTTLE_RATE"

    def identity(self, request):
        data = request.data
        name = str(data.get("username") or "").strip().lower()[:80] if hasattr(data, "get") else ""
        return hashlib.sha256(name.encode()).hexdigest()[:32] if name else None  # hashed: no odd characters in a cache key
