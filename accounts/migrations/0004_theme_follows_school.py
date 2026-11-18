from django.db import migrations, models


def forget_untouched(apps, schema_editor):
    """The old default was "light" for everybody, so nobody can tell a chosen "light" from an untouched one. Everyone starts
    following the school's default theme again; a person who wants a different one picks it in her settings."""
    apps.get_model("accounts", "User").objects.filter(theme="light").update(theme="")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_temp_password")]
    operations = [
        migrations.AlterField(model_name="user", name="theme", field=models.CharField(blank=True, default="", max_length=20)),
        migrations.RunPython(forget_untouched, migrations.RunPython.noop),
    ]
