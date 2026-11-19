from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0004_theme_follows_school")]
    operations = [migrations.AddField(model_name="user", name="accent", field=models.CharField(blank=True, default="", max_length=12))]
