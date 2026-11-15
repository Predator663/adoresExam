from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("core", "0004_branding_settings")]

    operations = [
        migrations.AddField(model_name="schoolsettings", name="practice_default_count", field=models.PositiveSmallIntegerField(default=10)),
        migrations.AddField(model_name="schoolsettings", name="student_photos_enabled", field=models.BooleanField(default=True)),
    ]
