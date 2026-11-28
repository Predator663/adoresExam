from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("exams", "0011_attempt_device"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.AddField(model_name="exam", name="returned_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="exam", name="returned_by", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
        migrations.AddField(model_name="exam", name="returned_to", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="returned_exams", to=settings.AUTH_USER_MODEL)),
        migrations.AddField(model_name="exam", name="return_reason", field=models.TextField(blank=True, default="")),
        migrations.AddField(model_name="exam", name="return_seen_at", field=models.DateTimeField(blank=True, null=True)),
    ]
