from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("questions", "0002_approve_submitted")]
    operations = [
        migrations.AlterField(
            model_name="question",
            name="qtype",
            field=models.CharField(
                choices=[("mcq_single", "Multiple choice (one answer)"), ("mcq_multi", "Multiple choice (several answers)"), ("true_false", "True or false"),
                         ("matching", "Matching"), ("fill_blank", "Fill in the blank"), ("fill_multi", "Fill in the blanks (several)"), ("ordering", "Ordering")],
                max_length=12),
        ),
    ]
