import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("questions", "0004_question_time_limit"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="QuestionShare",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("pending", "Waiting"), ("approved", "Approved"), ("denied", "Denied"), ("revoked", "Withdrawn"), ("cancelled", "Cancelled")], default="pending", max_length=10)),
                ("note", models.CharField(blank=True, max_length=300)),
                ("reply", models.CharField(blank=True, max_length=300)),
                ("requested_at", models.DateTimeField(auto_now_add=True)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="question_requests_received", to=settings.AUTH_USER_MODEL)),
                ("question", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="shares", to="questions.question")),
                ("requester", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="question_requests", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-requested_at", "-id"],
                     "indexes": [models.Index(fields=["owner", "status"], name="qshare_owner_status_idx"), models.Index(fields=["requester", "status"], name="qshare_req_status_idx")],
                     "constraints": [models.UniqueConstraint(fields=("question", "requester"), name="qshare_one_per_pair")]},
        ),
    ]
