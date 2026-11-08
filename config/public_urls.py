"""What the PLATFORM's own address (no school) serves: the platform admin (school list), the owner's control room for ALL schools
(maintenance switch), the health check and the uploaded files. Everything a school does (/api/...) is answered inside a school only."""
from django.contrib import admin
from django.urls import include, path, re_path

from accounts.adminguard import guarded_admin_login
from controlroom.views import site_status
from schools.views import healthz, media

urlpatterns = [
    path("", healthz),
    path("healthz", healthz),
    path("django-admin/login/", guarded_admin_login),  # same page, with sign-in limits (accounts/adminguard.py)
    path("django-admin/", admin.site.urls),
    path("controlroom/", include("controlroom.urls")),
    path("api/site-status/", site_status),
    re_path(r"^media/(?P<path>.*)$", media),
]
