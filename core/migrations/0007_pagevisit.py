import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0006_presence"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="PageVisit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uid", models.CharField(max_length=36)),
                ("path", models.CharField(db_index=True, max_length=120)),
                ("screen", models.CharField(blank=True, max_length=60)),
                ("entered_at", models.DateTimeField(db_index=True)),
                ("seconds", models.PositiveIntegerField(default=0)),
                ("device_type", models.CharField(blank=True, max_length=10)),
                ("standalone", models.BooleanField(default=False)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="page_visits", to=settings.AUTH_USER_MODEL)),
            ],
            options={"indexes": [models.Index(fields=["user", "-entered_at"], name="pagevisit_user_time_idx")],
                     "constraints": [models.UniqueConstraint(fields=("user", "uid"), name="pagevisit_unique_uid")]},
        ),
    ]
