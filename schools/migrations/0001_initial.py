import django.db.models.deletion
import django_tenants.models
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="School",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("schema_name", models.CharField(db_index=True, max_length=63, unique=True)),
                ("name", models.CharField(max_length=200)),
                ("is_active", models.BooleanField(default=True, help_text="Untick to suspend the school: its web app and API answer 'suspended'. Nothing is deleted.")),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["name"]},
            bases=(django_tenants.models.TenantMixin, models.Model),
        ),
        migrations.CreateModel(
            name="Domain",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("domain", models.CharField(db_index=True, max_length=253, unique=True)),
                ("is_primary", models.BooleanField(db_index=True, default=True)),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="domains", to="schools.school")),
            ],
            options={"abstract": False},
            bases=(django_tenants.models.DomainMixin, models.Model),
        ),
    ]
