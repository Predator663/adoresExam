from django.contrib import admin
from django.urls import include, path, re_path

from controlroom.views import site_status
from schools.views import media

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("controlroom/", include("controlroom.urls")),   # owner-only control room: maintenance mode + God's Eye
    path("api/site-status/", site_status),               # public: the web app asks whether to show the maintenance screen
    path("api/", include("accounts.urls")),
    path("api/", include("academics.urls")),
    path("api/", include("questions.urls")),
    path("api/", include("exams.urls")),
    path("api/", include("core.urls")),
    path("api/", include("notifications.urls")),
    path("api/", include("analytics.urls")),
    path("api/", include("gamification.urls")),
    path("api/", include("guardians.urls")),
    path("api/", include("proctoring.urls")),
]

# Question images and the school logo are saved under MEDIA_ROOT/<school>/ (a persistent disk on Render). gunicorn does not serve them by
# itself, so Django does: fine for the few small images of a school (the web app asks the API address for them, see mediaUrl()).
# The school is part of the address (/media/<school>/...), so no login and no school header is needed (see schools/views.py).
urlpatterns += [re_path(r"^media/(?P<path>.*)$", media)]
