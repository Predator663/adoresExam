from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("gamification", "0006_tournaments")]
    operations = [migrations.AddField(model_name="tournament", name="stakes", field=models.JSONField(blank=True, default=dict))]
