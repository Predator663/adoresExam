import os
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils.crypto import get_random_string
from django_tenants.utils import get_public_schema_name, schema_context

from schools.middleware import SCHEMA_RE, clean_host
from schools.branding import set_identity
from schools.models import Domain, School

ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


class Command(BaseCommand):
    help = ("Create a school: its own data area (schema), its web address(es), a school administrator and the owner login.\n"
            "  python manage.py create_school \"Kilimo Secondary\" --domain exams.kilimo.ac.tz --admin-username headmaster")

    def add_arguments(self, p):
        p.add_argument("name")
        p.add_argument("--domain", action="append", required=True, help="address of the school's web app, no https:// (repeat for more)")
        p.add_argument("--schema", default="", help="short lowercase name of the data area (default: made from the name). Cannot be changed later.")
        p.add_argument("--admin-username", default="admin")
        p.add_argument("--admin-password", default="")
        p.add_argument("--owner-username", default="", help="default: the first name in CONTROLROOM_OWNERS")
        p.add_argument("--owner-password", default="")
        p.add_argument("--short-name", default="", help="e.g. Kilimo: the app is then called 'Kilimo Exams' (default: first word of the name)")
        p.add_argument("--email", default="")
        p.add_argument("--phone", default="")
        p.add_argument("--address", default="")
        p.add_argument("--logo", default="", help="path of the school's logo image (PNG/JPG). Can also be uploaded later in Staff > Settings.")

    def handle(self, *args, name, domain, schema, admin_username, admin_password, owner_username, owner_password, short_name, email, phone, address, logo, **o):
        schema = schema or re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40]
        if not SCHEMA_RE.match(schema) or schema == get_public_schema_name() or schema.startswith("pg_"):
            raise CommandError(f"'{schema}' is not a usable schema name (lowercase letters, digits, underscore; start with a letter). Use --schema.")
        hosts = [clean_host(d) for d in domain]
        if not all(hosts):
            raise CommandError("A --domain is not a plain address like exams.school.ac.tz")
        if School.objects.filter(schema_name=schema).exists():
            raise CommandError(f"A school with schema '{schema}' already exists.")
        if logo and not os.path.isfile(logo):
            raise CommandError(f"Logo file not found: {logo}")
        taken = Domain.objects.filter(domain__in=hosts).values_list("domain", flat=True)
        if taken:
            raise CommandError("Already registered: " + ", ".join(taken))
        owners = [x.strip() for x in (getattr(settings, "CONTROLROOM_OWNERS", "") or "").split(",") if x.strip()]
        owner_username = owner_username or (owners[0] if owners else "")

        self.stdout.write(f"Creating the data area '{schema}' (this builds all tables, it can take a minute)...")
        school = School(schema_name=schema, name=name)
        school.save()  # creates the schema and runs every tenant migration in it
        for i, h in enumerate(hosts):
            Domain.objects.create(domain=h, tenant=school, is_primary=(i == 0))

        User = get_user_model()
        made = []
        with schema_context(schema):
            set_identity(name, short_name=short_name, email=email, phone=phone, address=address, logo=logo)
            admin_password = admin_password or get_random_string(12, ALPHABET)
            User.objects.create_user(admin_username, password=admin_password, role="super_admin", must_change_password=True)
            made.append((admin_username, admin_password, "school administrator (must change the password at the first login)"))
            if owner_username and owner_username != admin_username:
                owner_password = owner_password or get_random_string(16, ALPHABET)
                User.objects.create_superuser(owner_username, password=owner_password)
                made.append((owner_username, owner_password, "OWNER (opens /django-admin/ and the control room of this school, passes maintenance mode)"))

        self.stdout.write(self.style.SUCCESS(f"\nSchool '{name}' is ready.  schema={schema}  address(es)={', '.join(hosts)}"))
        self.stdout.write("Logins (shown only now, write them down):")
        for u, p, what in made:
            self.stdout.write(f"  {u}  /  {p}    {what}")
        if not owner_username:
            self.stdout.write("  (no owner login made: set CONTROLROOM_OWNERS or pass --owner-username)")
        self.stdout.write("\nNext: add each address to the Render Static Site (Settings > Custom Domains) and point its DNS CNAME there.")
        self.stdout.write(f"The school's admin pages:  https://<api address>/django-admin/?school={hosts[0]}")
