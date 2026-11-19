from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("gamification", "0002_profile_photo")]
    operations = [
        migrations.AddField(model_name="profile", name="frame", field=models.CharField(default="ring", max_length=12)),
        migrations.AddField(model_name="profile", name="title_level", field=models.PositiveSmallIntegerField(blank=True, null=True)),
        migrations.AddField(model_name="profile", name="goal_percent", field=models.PositiveSmallIntegerField(blank=True, null=True)),
        migrations.AddField(model_name="profile", name="goal_subject", field=models.CharField(blank=True, max_length=60)),
    ]
