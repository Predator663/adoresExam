from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("exams", "0009_papersheet")]

    operations = [
        migrations.AddField(model_name="exam", name="allow_review", field=models.BooleanField(default=True)),
    ]
