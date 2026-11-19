"""Personal look: frames and titles unlock with level.  python manage.py test gamification.test_personal"""
from django.test import SimpleTestCase

from gamification.models import FRAMES


class FrameRulesTests(SimpleTestCase):
    def test_everyone_starts_with_plain_and_ring(self):
        self.assertEqual(FRAMES["none"], 1)
        self.assertEqual(FRAMES["ring"], 1)

    def test_better_frames_need_a_higher_level(self):
        self.assertGreater(FRAMES["crown"], FRAMES["sun"])
        self.assertTrue(all(1 <= lv <= 7 for lv in FRAMES.values()))
