"""Uploaded files (question images, school logo) are kept in one folder per school: MEDIA_ROOT/<school>/...  and are addressed as
/media/<school>/...  The names are random (questions/views.py), so an address cannot be guessed."""
import os

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import connection


def _schema():
    return getattr(connection, "schema_name", None) or "public"


class SchoolFileSystemStorage(FileSystemStorage):
    @property
    def base_location(self):
        return os.path.join(str(settings.MEDIA_ROOT), _schema())

    @property
    def location(self):
        return os.path.abspath(self.base_location)

    @property
    def base_url(self):
        return f"{settings.MEDIA_URL.rstrip('/')}/{_schema()}/"
