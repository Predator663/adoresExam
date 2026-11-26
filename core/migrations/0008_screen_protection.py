from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0007_pagevisit")]
    operations = [migrations.AddField(model_name="schoolsettings", name="screen_protection", field=models.CharField(default="off", max_length=6))]
