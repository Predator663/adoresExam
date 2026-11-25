import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("academics", "__first__"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("gamification", "0005_practice_adaptive"),
    ]
    operations = [
        migrations.CreateModel(
            name="Tournament",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("items", models.JSONField(default=list)),
                ("question_count", models.PositiveSmallIntegerField(default=0)),
                ("seconds_per_question", models.PositiveSmallIntegerField(default=30)),
                ("status", models.CharField(default="open", max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("result", models.JSONField(blank=True, default=dict)),
                ("challenger", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tournaments_made", to=settings.AUTH_USER_MODEL)),
                ("opponent", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tournaments_received", to=settings.AUTH_USER_MODEL)),
                ("subject", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tournaments", to="academics.subject")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="TournamentPlay",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("seed", models.PositiveIntegerField(default=0)),
                ("order", models.JSONField(default=list)),
                ("answers", models.JSONField(blank=True, default=list)),
                ("question_started_at", models.DateTimeField(blank=True, null=True)),
                ("status", models.CharField(default="in_progress", max_length=12)),
                ("started_at", models.DateTimeField(auto_now_add=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("score", models.FloatField(default=0)),
                ("time_ms", models.PositiveIntegerField(default=0)),
                ("tournament", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="plays", to="gamification.tournament")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tournament_plays", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddIndex(model_name="tournament", index=models.Index(fields=["status", "expires_at"], name="tour_status_expires_idx")),
        migrations.AddConstraint(model_name="tournamentplay", constraint=models.UniqueConstraint(fields=("tournament", "user"), name="one_play_per_player")),
    ]
