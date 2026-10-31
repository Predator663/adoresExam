from django.db import models
from django_tenants.models import DomainMixin, TenantMixin


class School(TenantMixin):
    """One school = one PostgreSQL schema inside the same database. Its users, classes, exams, results ... live only there."""

    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True, help_text="Untick to suspend the school: its web app and API answer 'suspended'. Nothing is deleted.")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    auto_create_schema = True   # the schema (and its tables) is created when the row is saved
    auto_drop_schema = False    # NEVER drop a school's data because a row was deleted

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name or self.schema_name


class Domain(DomainMixin):
    """A web address that belongs to a school: the address of its web app (what the browser sends as X-School), e.g. exams.school.ac.tz."""
