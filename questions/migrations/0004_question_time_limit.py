from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("questions", "0003_fill_multi_choice")]
    operations = [
        migrations.AddField(model_name="question", name="time_limit_seconds", field=models.PositiveIntegerField(blank=True, null=True)),
    ]
