from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("exams", "0010_exam_allow_review")]

    operations = [
        migrations.AddField(model_name="attempt", name="device_id", field=models.CharField(blank=True, default="", max_length=64)),
        migrations.AddField(model_name="attempt", name="device_seen_at", field=models.DateTimeField(blank=True, null=True)),
    ]
