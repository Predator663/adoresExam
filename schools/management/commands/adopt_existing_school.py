"""ONE-TIME step when moving a database that already holds one school's data (everything in the PUBLIC schema) to the multi-school layout.

It moves every old table out of 'public' into a new schema for that school, inside one database transaction: if anything fails nothing
changes. Then it builds the platform tables in 'public', registers the school and its address(es), and moves the uploaded files into the
school's folder."""
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from schools.middleware import SCHEMA_RE, clean_host
from schools.models import Domain, School


class Command(BaseCommand):
    help = "ONE-TIME: turn the existing single-school database into the first school.  Add --yes to really do it (without it: only a report)."

    def add_arguments(self, p):
        p.add_argument("name", help="the school's name, e.g. 'Amani Girls Secondary School'")
        p.add_argument("--schema", default="amani")
        p.add_argument("--domain", action="append", required=True, help="address of this school's web app, no https:// (repeat for more)")
        p.add_argument("--yes", action="store_true")
        p.add_argument("--skip-media", action="store_true", help="do not move the uploaded files")
        p.add_argument("--logo", default="", help="the school's logo, e.g. frontend/public/logo.png (the web app used to ship it as a file; now it comes from the school's settings)")

    def handle(self, *args, name, schema, domain, yes, skip_media, logo, **o):
        connection.set_schema_to_public()
        if not SCHEMA_RE.match(schema) or schema == "public" or schema.startswith("pg_"):
            raise CommandError(f"'{schema}' is not a usable schema name.")
        hosts = [clean_host(d) for d in domain]
        if not all(hosts):
            raise CommandError("A --domain is not a plain address like exams.school.ac.tz")
        q = connection.ops.quote_name

        with connection.cursor() as c:
            c.execute("select to_regclass('public.accounts_user'), to_regclass('public.schools_school')")
            old, platform = c.fetchone()
            if not platform:
                raise CommandError("The platform tables are missing. First run:  python manage.py migrate_schemas --shared")
            if not old:
                raise CommandError("Nothing to adopt: there is no accounts_user table in 'public' (already done?).")
            c.execute("select 1 from information_schema.schemata where schema_name = %s", [schema])
            if c.fetchone():
                raise CommandError(f"A schema called '{schema}' already exists.")
            c.execute("select count(*) from public.schools_school")
            if c.fetchone()[0]:
                raise CommandError("A school is already registered; this step is only for the very first one.")
            c.execute("select tablename from pg_tables where schemaname = 'public' order by 1")
            tables = [t for (t,) in c.fetchall() if not t.startswith("schools_")]
            c.execute("select count(*) from public.accounts_user")
            users = c.fetchone()[0]

        self.stdout.write(f"Found {len(tables)} tables in 'public' with {users} user(s). They will move to schema '{schema}'.")
        if not yes:
            self.stdout.write(self.style.WARNING("Report only. Take a database backup, then run again with --yes."))
            return

        with transaction.atomic():  # PostgreSQL can roll back table moves: all or nothing
            with connection.cursor() as c:
                c.execute(f"CREATE SCHEMA {q(schema)}")
                # The school keeps its own migration history, the platform starts a fresh one.
                c.execute(f"CREATE TABLE {q(schema)}.django_migrations (LIKE public.django_migrations INCLUDING ALL)")
                c.execute(f"INSERT INTO {q(schema)}.django_migrations SELECT * FROM public.django_migrations")
                c.execute(f"SELECT setval(pg_get_serial_sequence(%s, 'id'), (SELECT coalesce(max(id), 1) FROM {q(schema)}.django_migrations))",
                          [f"{q(schema)}.django_migrations"])
                for t in tables:
                    if t != "django_migrations":
                        c.execute(f"ALTER TABLE public.{q(t)} SET SCHEMA {q(schema)}")
                c.execute("DELETE FROM public.django_migrations WHERE app <> 'schools'")
        self.stdout.write("Tables moved. Building the platform tables in 'public' ...")

        call_command("migrate_schemas", "--shared")
        connection.set_schema_to_public()
        school = School(schema_name=schema, name=name)
        school.auto_create_schema = False  # the schema already exists and is full of data
        school.save()
        for i, h in enumerate(hosts):
            Domain.objects.create(domain=h, tenant=school, is_primary=(i == 0))
        call_command("migrate_schemas", f"--schema={schema}")  # applies any migration newer than the data (normally none)

        moved = 0 if skip_media else self._move_media(schema)
        if logo:
            from django_tenants.utils import schema_context
            from schools.branding import set_identity
            with schema_context(schema):
                set_identity("", logo=logo, keep_name=True)  # keeps the name already in the school's settings, only adds the logo
        self.stdout.write(self.style.SUCCESS(
            f"\nDone. '{name}' is school '{schema}' at {', '.join(hosts)}; {moved} upload folder(s)/file(s) moved.\n"
            f"Now set LEGACY_SCHOOL_SCHEMA={schema} on the API service so the OLD web app and the paired SMS phone keep working until you redeploy the web app."))

    def _move_media(self, schema):
        root = Path(settings.MEDIA_ROOT)
        if not root.is_dir():
            return 0
        known = set(School.objects.values_list("schema_name", flat=True)) | {schema}
        dest = root / schema
        dest.mkdir(exist_ok=True)
        n = 0
        for item in sorted(root.iterdir()):
            if item.name in known or item.name.startswith("."):
                continue
            target = dest / item.name
            if target.exists():
                self.stdout.write(self.style.WARNING(f"  skipped {item.name}: already in {dest}"))
                continue
            shutil.move(str(item), str(target))
            n += 1
        return n
