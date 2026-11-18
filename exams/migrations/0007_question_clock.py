from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("exams", "0006_savedquestion")]
    operations = [
        migrations.AddField(model_name="attempt", name="question_started_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="answer", name="timed_out", field=models.BooleanField(default=False)),
    ]
