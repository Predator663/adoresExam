"""The evening reminder for a practice streak that would break today."""
from datetime import datetime, timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from gamification.models import ActivityDay
from .models import Notification
from .services import run_streak_reminders


class StreakReminderTests(TestCase):
    def setUp(self):
        self.now = timezone.make_aware(datetime(2026, 11, 10, 18, 0))
        self.today = timezone.localtime(self.now).date()
        self.s = User.objects.create(username="s1", role="student")
        for back in (1, 2, 3):  # a 3-day streak up to yesterday
            ActivityDay.objects.create(user=self.s, day=self.today - timedelta(days=back), source="practice")

    def test_reminds_once_in_the_evening(self):
        self.assertEqual(run_streak_reminders(self.now), 1)
        n = Notification.objects.get(user=self.s, kind="streak_reminder")
        self.assertIn("3", n.title)
        self.assertEqual(run_streak_reminders(self.now), 0)  # the key makes it once a day

    def test_not_before_the_evening(self):
        early = self.now.replace(hour=9)
        self.assertEqual(run_streak_reminders(early), 0)

    def test_not_if_she_already_practised_today(self):
        ActivityDay.objects.create(user=self.s, day=self.today, source="practice")
        self.assertEqual(run_streak_reminders(self.now), 0)

    def test_not_for_a_one_day_streak(self):
        ActivityDay.objects.filter(user=self.s).exclude(day=self.today - timedelta(days=1)).delete()
        self.assertEqual(run_streak_reminders(self.now), 0)
