import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("exams", "0005_builderdraft"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SavedQuestion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("number", models.PositiveSmallIntegerField()),
                ("snapshot", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("attempt", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to="exams.attempt")),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="saved_questions", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at", "-id"], "unique_together": {("student", "attempt", "number")}},
        ),
    ]
