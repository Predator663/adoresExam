import argparse

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django_tenants.utils import get_public_schema_name, schema_context

from schools.models import School


class Command(BaseCommand):
    help = ("Run a management command once for every school, inside that school's data:\n"
            "  python manage.py for_each_school run_scheduler\n"
            "  python manage.py for_each_school --only amani maintenance on\n"
            "Suspended schools are skipped unless --include-suspended.")

    def add_arguments(self, parser):
        parser.add_argument("--only", default="", help="comma-separated schema names")
        parser.add_argument("--include-suspended", action="store_true")
        parser.add_argument("command")
        parser.add_argument("args", nargs=argparse.REMAINDER)

    def handle(self, *args, command, **opts):
        qs = School.objects.exclude(schema_name=get_public_schema_name()).order_by("schema_name")
        if not opts["include_suspended"]:
            qs = qs.filter(is_active=True)
        only = [x.strip() for x in opts["only"].split(",") if x.strip()]
        if only:
            qs = qs.filter(schema_name__in=only)
        failed = []
        for s in qs:
            self.stdout.write(f"== {s.schema_name}")
            try:
                with schema_context(s.schema_name):
                    # Django strips the "args" positional out of opts and passes it
                    # in as *args, so read it from there (opts["args"] raises KeyError).
                    call_command(command, *args, stdout=self.stdout, stderr=self.stderr)
            except Exception as e:  # one broken school must not stop the others
                failed.append(s.schema_name)
                self.stderr.write(f"!! {s.schema_name}: {type(e).__name__}: {e}")
        if failed:
            raise CommandError("failed for: " + ", ".join(failed))
