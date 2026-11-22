import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("exams", "0007_question_clock"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.AddField(model_name="result", name="revision", field=models.PositiveSmallIntegerField(default=0)),
        migrations.AddField(model_name="result", name="corrected_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="result", name="previous", field=models.JSONField(blank=True, null=True)),
        migrations.CreateModel(
            name="ExamCorrection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("number", models.PositiveIntegerField()),
                ("reason", models.CharField(max_length=300)),
                ("before", models.JSONField(default=dict)),
                ("after", models.JSONField(default=dict)),
                ("students", models.PositiveIntegerField(default=0)),
                ("changed", models.PositiveIntegerField(default=0)),
                ("up", models.PositiveIntegerField(default=0)),
                ("down", models.PositiveIntegerField(default=0)),
                ("notified", models.PositiveIntegerField(default=0)),
                ("bank_updated", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("exam", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="corrections", to="exams.exam")),
                ("exam_question", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="corrections", to="exams.examquestion")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.CreateModel(
            name="ResultChange",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("before", models.JSONField()),
                ("after", models.JSONField()),
                ("correction", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="changes", to="exams.examcorrection")),
                ("result", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="changes", to="exams.result")),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-id"]},
        ),
    ]
