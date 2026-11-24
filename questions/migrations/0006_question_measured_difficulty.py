from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("questions", "0005_questionshare")]
    operations = [
        migrations.AddField(model_name="question", name="ml_difficulty", field=models.FloatField(blank=True, null=True)),
        migrations.AddField(model_name="question", name="ml_label", field=models.CharField(blank=True, default="", max_length=6)),
        migrations.AddField(model_name="question", name="ml_samples", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="question", name="ml_source", field=models.CharField(blank=True, default="", max_length=9)),
        migrations.AddField(model_name="question", name="ml_updated", field=models.DateTimeField(blank=True, null=True)),
    ]
