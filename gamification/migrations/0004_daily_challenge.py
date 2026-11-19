from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("gamification", "0003_personal")]
    operations = [migrations.AddField(model_name="practicesession", name="daily", field=models.BooleanField(default=False))]
