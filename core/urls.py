from django.urls import path

from . import views

urlpatterns = [
    path("presence/", views.presence),
    path("online-now/", views.online_now),
    path("page-visits/", views.page_visits_in),
    path("page-visits/log/", views.page_visits),
    path("page-visits/summary/", views.page_visits_summary),
    path("branding/", views.branding),
    path("settings/", views.school_settings),
    path("settings/logo/", views.settings_logo),
    path("audit-log/", views.audit_log),
    path("i18n/<str:lang>/", views.i18n_catalog),
]
