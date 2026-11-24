from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("gamification", "0004_daily_challenge")]
    operations = [migrations.AddField(model_name="practicesession", name="adaptive", field=models.JSONField(blank=True, default=dict))]
