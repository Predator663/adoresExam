from pathlib import Path

from django.conf import settings
from django.http import Http404, JsonResponse
from django.views.decorators.cache import never_cache
from django.views.static import serve


def media(request, path):
    """/media/<school>/<file>. The school is part of the address, so this needs no login and no school header (an <img> tag cannot send one).

    Older addresses without the school folder (/media/question_images/x.png, saved inside questions before schools existed) and files not yet
    moved into the school's folder are found through LEGACY_SCHOOL_SCHEMA."""
    if ".." in path.split("/"):
        raise Http404
    root = Path(settings.MEDIA_ROOT)
    legacy = getattr(settings, "LEGACY_SCHOOL_SCHEMA", "")
    if legacy and not (root / path).is_file():
        if (root / legacy / path).is_file():
            path = f"{legacy}/{path}"
        elif path.startswith(legacy + "/") and (root / path[len(legacy) + 1:]).is_file():
            path = path[len(legacy) + 1:]
    return serve(request, path, document_root=root)


@never_cache
def healthz(request):
    return JsonResponse({"ok": True})
