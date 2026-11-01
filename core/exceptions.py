"""One place that decides what the web app is told when something breaks.
A crash must never reach a student as a stack trace, a file name or an SQL message: the details go to the server log only."""
import logging

from rest_framework.response import Response
from rest_framework.views import exception_handler

log = logging.getLogger("amani.errors")


def friendly_exception_handler(exc, context):
    response = exception_handler(exc, context)  # DRF's own answers (400, 401, 403, 404, 429...) stay as they are
    if response is not None:
        return response
    request = context.get("request")
    log.exception("unhandled error on %s %s", getattr(request, "method", "?"), getattr(request, "path", "?"), exc_info=exc)
    return Response({"detail": "Something went wrong on our side. Please try again in a moment.", "code": "server_error"}, status=500)
