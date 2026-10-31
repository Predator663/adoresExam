"""Cache keys that include the school, so one school's login-lockout counters, heartbeats and throttles never touch another's.

Used through CACHES[...]["KEY_FUNCTION"] in settings."""
from django.db import connection


def make_key(key, key_prefix, version):
    schema = getattr(connection, "schema_name", None) or "public"
    return f"{key_prefix}:{schema}:{version}:{key}"
