from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("core", "0003_leave_lock_settings")]

    operations = [
        migrations.AddField(model_name="schoolsettings", name="short_name", field=models.CharField(blank=True, default="", max_length=40)),
        migrations.AddField(model_name="schoolsettings", name="contact_email", field=models.CharField(blank=True, default="", max_length=120)),
        migrations.AddField(model_name="schoolsettings", name="contact_phone", field=models.CharField(blank=True, default="", max_length=40)),
        migrations.AddField(model_name="schoolsettings", name="address", field=models.CharField(blank=True, default="", max_length=200)),
    ]
