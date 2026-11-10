import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("exams", "0004_attempt_ended_by"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BuilderDraft",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("data", models.JSONField(default=dict)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("exam", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="builder_drafts", to="exams.exam")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
            options={"unique_together": {("exam", "user")}},
        ),
    ]
