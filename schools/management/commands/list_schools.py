from django.core.management.base import BaseCommand
from django_tenants.utils import get_public_schema_name

from schools.models import School


class Command(BaseCommand):
    help = "List the schools, their schema and web addresses."

    def handle(self, *args, **opts):
        n = 0
        for s in School.objects.exclude(schema_name=get_public_schema_name()).prefetch_related("domains"):
            n += 1
            doms = ", ".join(d.domain + ("*" if d.is_primary else "") for d in s.domains.all()) or "(no address!)"
            self.stdout.write(f"{s.schema_name:<20} {'active ' if s.is_active else 'SUSPENDED'} {s.name}  ->  {doms}")
        if not n:
            self.stdout.write("No schools yet. Create one with: python manage.py create_school")
