"""Platform admin: only on the PLATFORM (the public address), only for the owner. A school's own /django-admin/ never shows these tables,
even though PostgreSQL could read them through the search path."""
from django.contrib import admin
from django.db import connection
from django.utils.html import format_html
from django_tenants.utils import get_public_schema_name

from controlroom.admin import OwnerModelAdmin

from .models import Domain, School


class PlatformOnly:
    def _platform(self):
        return (getattr(connection, "schema_name", None) or get_public_schema_name()) == get_public_schema_name()

    def has_module_permission(self, request):
        return self._platform() and super().has_module_permission(request)

    def has_view_permission(self, request, obj=None):
        return self._platform() and super().has_view_permission(request, obj)

    def has_add_permission(self, request):
        return self._platform() and super().has_add_permission(request)

    def has_change_permission(self, request, obj=None):
        return self._platform() and super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        return self._platform() and super().has_delete_permission(request, obj)


class DomainInline(admin.TabularInline):
    model = Domain
    extra = 0


@admin.register(School)
class SchoolAdmin(PlatformOnly, OwnerModelAdmin):
    can_add = False  # creating a school builds its tables (can take a minute, longer than a web request may): use  manage.py create_school
    list_display = ("name", "schema_name", "is_active", "addresses", "created_at", "open_admin")
    list_filter = ("is_active",)
    search_fields = ("name", "schema_name", "domains__domain")
    readonly_fields = ("schema_name", "created_at")
    inlines = [DomainInline]

    def has_delete_permission(self, request, obj=None):
        return False  # suspend (untick Active) instead: deleting a school row must never be one click away from its data

    @admin.display(description="Addresses")
    def addresses(self, obj):
        return ", ".join(d.domain for d in obj.domains.all())

    @admin.display(description="Its admin")
    def open_admin(self, obj):
        d = obj.domains.order_by("-is_primary", "id").first()
        return format_html('<a href="/django-admin/?school={}">open</a>', d.domain) if d else ""


@admin.register(Domain)
class DomainAdmin(PlatformOnly, OwnerModelAdmin):
    list_display = ("domain", "tenant", "is_primary")
    search_fields = ("domain", "tenant__name")
