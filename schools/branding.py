"""Writes a school's identity (name, short name, contact, logo) into ITS settings. Call it inside schema_context(<school>)."""
import io
import os

from django.core.files.base import ContentFile


def set_identity(name, short_name="", email="", phone="", address="", logo="", keep_name=False):
    from core.models import SchoolSettings

    s = SchoolSettings.load()
    if not keep_name and name:
        s.school_name = name
    for field, value in (("short_name", short_name), ("contact_email", email), ("contact_phone", phone), ("address", address)):
        if value:
            setattr(s, field, value)
    if logo and os.path.isfile(logo):
        from PIL import Image  # same treatment as Staff > Settings > Logo: at most 512x512, saved as PNG
        img = Image.open(logo)
        img.load()
        img.thumbnail((512, 512))
        buf = io.BytesIO()
        img.convert("RGBA").save(buf, format="PNG")
        s.logo.save("logo.png", ContentFile(buf.getvalue()), save=False)
    s.save()
    return s
