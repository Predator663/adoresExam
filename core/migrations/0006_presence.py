import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("core", "0005_practice_photo_settings"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="Presence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("last_seen", models.DateTimeField(db_index=True)),
                ("session_start", models.DateTimeField()),
                ("ip", models.CharField(blank=True, max_length=45)),
                ("user_agent", models.CharField(blank=True, max_length=300)),
                ("browser", models.CharField(blank=True, max_length=40)),
                ("browser_version", models.CharField(blank=True, max_length=20)),
                ("os", models.CharField(blank=True, max_length=40)),
                ("os_version", models.CharField(blank=True, max_length=30)),
                ("device_type", models.CharField(blank=True, max_length=10)),
                ("device", models.CharField(blank=True, max_length=60)),
                ("screen", models.CharField(blank=True, max_length=14)),
                ("connection", models.CharField(blank=True, max_length=10)),
                ("language", models.CharField(blank=True, max_length=12)),
                ("standalone", models.BooleanField(default=False)),
                ("page", models.CharField(blank=True, max_length=80)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="presence", to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
