"""Learn each question's real difficulty (easy / medium / hard for its class level) from how students answered.

  python manage.py for_each_school calibrate_difficulty            (a nightly cron job is plenty)
  python manage.py calibrate_difficulty --dry-run                  (inside one school: show what it would do, change nothing)
"""
from django.core.management.base import BaseCommand

from questions import calibrate


class Command(BaseCommand):
    help = "Measure question difficulty from student answers (never changes marks or teachers' own difficulty)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        s = calibrate.run(dry_run=opts["dry_run"])
        self.stdout.write(f"measured {s['measured']} question(s), predicted {s['predicted']}; labels {s['labels']}")
        if s["predictor"]:
            self.stdout.write(f"wording model: {s['predictor']}")
        if s["skipped_subjects"]:
            self.stdout.write(f"not enough answers yet for subject id(s) {s['skipped_subjects']}")
        if opts["dry_run"]:
            self.stdout.write("(dry run: nothing saved)")
