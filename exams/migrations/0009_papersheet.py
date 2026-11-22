import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("exams", "0008_corrections"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="PaperSheet",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=12, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("received_at", models.DateTimeField(blank=True, null=True)),
                ("entered_at", models.DateTimeField(blank=True, null=True)),
                ("attempt", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="paper_sheet", to="exams.attempt")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("entered_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("exam", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="paper_sheets", to="exams.exam")),
                ("received_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="paper_sheets", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["student__first_name", "student__last_name", "id"], "unique_together": {("exam", "student")}},
        ),
    ]
