"""1v1 tournaments:  python manage.py test gamification.test_tournaments"""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.utils import timezone

from accounts.models import User
from analytics.tests import AnalyticsBase
from notifications.models import Notification
from . import services, tournaments as T
from .models import BadgeAward, Profile, Tournament, TournamentPlay, XPEvent
from .tests import practice_question


class TournamentBase(AnalyticsBase):
    def setUp(self):
        super().setUp()
        for _ in range(8):
            practice_question(self.maths)
        self.neema = User.objects.create(username="neema", first_name="Neema", last_name="Test", role="student", school_class=self.cls_a,
                                         index_number="S3", password=make_password("pw-neema-1"))
        self.a, self.n = self.amina, self.neema   # classmates (class A); zawadi is in class B
        self.t0 = timezone.now()

    def declare(self, **kw):
        args = dict(count=5, seconds=30, hours=48)
        args.update(kw)
        return T.create(self.a, self.maths.pk, self.n.pk, now=self.t0, **args)

    def play_run(self, tour, user, answer, start, per_q=5):
        """Play a whole run on a simulated clock; per_q seconds spent on every question."""
        now = start
        cur = T.play(tour.pk, user, now)
        while cur:
            now += timedelta(seconds=per_q)
            cur = T.answer(tour.pk, user, cur["question"]["id"], answer, now)
        return now


class SetupAndPrivacyTests(TournamentBase):
    def test_only_visible_classmates_can_be_challenged(self):
        ids = [c["id"] for c in T.classmates(self.a)]
        self.assertEqual(ids, [self.n.pk])                      # not herself, not zawadi (other class)
        Profile.objects.update_or_create(user=self.n, defaults={"hide_from_leaderboard": True})
        self.assertEqual(T.classmates(self.a), [])              # a student who hid herself is not offered
        with self.assertRaises(services.GamificationError) as e:
            T.create(self.a, self.maths.pk, self.zawadi.pk, now=self.t0)
        self.assertEqual(e.exception.code, "not_classmate")

    def test_strangers_cannot_see_it_and_answers_never_travel(self):
        tour = self.declare()
        self.assertEqual(self.client_for(self.zawadi).get(f"/api/tournaments/{tour.pk}/").status_code, 404)
        self.assertEqual(self.client_for(self.zawadi).post(f"/api/tournaments/{tour.pk}/play/").status_code, 404)
        c = self.client_for(self.n)
        inv = c.get("/api/tournaments/").json()["invites"]
        self.assertEqual([i["id"] for i in inv], [tour.pk])
        q = c.post(f"/api/tournaments/{tour.pk}/play/").json()["current"]["question"]
        self.assertNotIn("answer", q)
        self.assertEqual(Notification.objects.filter(user=self.n, kind="tournament_invite").count(), 1)

    def test_limits_and_bad_choices(self):
        self.declare()
        with self.assertRaises(services.GamificationError) as e:
            self.declare()
        self.assertEqual(e.exception.code, "already_open")      # one open tournament per pair
        for bad in ({"count": 7}, {"seconds": 5}, {"hours": 1000}):
            with self.assertRaises(services.GamificationError):
                T.create(self.a, self.maths.pk, self.n.pk, now=self.t0, **({"count": 5, "seconds": 30, "hours": 48} | bad))
        with self.assertRaises(services.GamificationError) as e:
            T.create(self.a, self.maths.pk, self.n.pk, count=15, seconds=30, hours=48, now=self.t0)
        self.assertEqual(e.exception.code, "few_questions")     # only 8 practice questions exist

    def test_three_waiting_at_most(self):
        others = [User.objects.create(username=f"x{i}", role="student", school_class=self.cls_a, index_number=f"X{i}", password=make_password("pw-x-1")) for i in range(4)]
        for o in others[:3]:
            T.create(self.a, self.maths.pk, o.pk, count=5, seconds=30, hours=48, now=self.t0)
        with self.assertRaises(services.GamificationError) as e:
            T.create(self.a, self.maths.pk, others[3].pk, count=5, seconds=30, hours=48, now=self.t0)
        self.assertEqual(e.exception.code, "too_many")


class DuelTests(TournamentBase):
    def test_both_get_the_same_questions_in_their_own_order(self):
        tour = self.declare()
        T.play(tour.pk, self.a, self.t0)
        T.play(tour.pk, self.n, self.t0)
        pa, pn = (TournamentPlay.objects.get(tournament=tour, user=u) for u in (self.a, self.n))
        self.assertEqual(sorted(pa.order), sorted(pn.order))
        self.assertEqual(len(tour.items), 5)

    def test_win_pays_xp_badges_and_notifies_both_once(self):
        tour = self.declare()
        end = self.play_run(tour, self.a, "b", self.t0)                   # all right
        self.assertEqual(Tournament.objects.get(pk=tour.pk).status, Tournament.OPEN)   # waiting for her classmate
        # nothing about the other score is visible while it is open
        v = T.detail(tour.pk, self.n, end)
        self.assertNotIn("result", v)
        self.assertEqual(v["opponent"]["status"], "finished")
        self.play_run(tour, self.n, "a", end + timedelta(hours=3))        # all wrong, hours later
        tour = Tournament.objects.get(pk=tour.pk)
        self.assertEqual((tour.status, tour.result["outcome"], tour.result["winner_id"], tour.result["how"]), ("finished", "win", self.a.pk, "score"))
        va, vn = T.detail(tour.pk, self.a), T.detail(tour.pk, self.n)
        self.assertEqual((va["result"]["outcome"], vn["result"]["outcome"]), ("won", "lost"))
        self.assertEqual((va["result"]["me"]["xp"], vn["result"]["me"]["xp"]), (50, 15))        # 15 play + 35 win / 15 play
        self.assertEqual(services.total_xp(self.a), 50)
        self.assertEqual({b["code"] for b in va["result"]["badges"]}, {"duelist", "tournament_champion", "flawless_victory"})
        self.assertEqual({b["code"] for b in vn["result"]["badges"]}, {"duelist"})
        self.assertEqual(len(va["result"]["questions"]), 5)
        self.assertEqual(Notification.objects.filter(kind="tournament_result", data__tournament_id=tour.pk).count(), 2)
        # settling again (a page reload, the scheduler) changes nothing
        T.settle_due(self.t0 + timedelta(days=9))
        T.detail(tour.pk, self.a)
        self.assertEqual((services.total_xp(self.a), services.total_xp(self.n)), (50, 15))
        self.assertEqual(BadgeAward.objects.filter(user=self.a, code="duelist").count(), 1)

    def test_equal_score_is_decided_by_time_then_draw(self):
        tour = self.declare()
        end = self.play_run(tour, self.a, "b", self.t0, per_q=2)
        self.play_run(tour, self.n, "b", end + timedelta(minutes=1), per_q=9)
        r = Tournament.objects.get(pk=tour.pk).result
        self.assertEqual((r["outcome"], r["winner_id"], r["how"]), ("win", self.a.pk, "time"))
        tour2 = T.create(self.n, self.maths.pk, self.a.pk, count=5, seconds=30, hours=48, now=self.t0 + timedelta(days=1))
        end = self.play_run(tour2, self.n, "b", self.t0 + timedelta(days=1), per_q=4)
        self.play_run(tour2, self.a, "b", end + timedelta(minutes=1), per_q=4)  # same speed: within a second in total
        r2 = Tournament.objects.get(pk=tour2.pk).result
        self.assertEqual((r2["outcome"], r2["winner_id"]), ("draw", None))
        self.assertEqual(XPEvent.objects.filter(user=self.n, kind="tournament_draw").count(), 1)

    def test_daily_xp_cap(self):
        for i in range(T.DAILY_XP_CAP):
            XPEvent.objects.create(user=self.a, kind="tournament", points=15, key=f"old:{i}")
        tour = self.declare()
        end = self.play_run(tour, self.a, "b", self.t0)
        self.play_run(tour, self.n, "a", end + timedelta(minutes=1))
        r = Tournament.objects.get(pk=tour.pk).result
        self.assertEqual(r["players"][str(self.a.pk)]["xp"], 0)          # over today's limit: no XP ...
        self.assertEqual(r["winner_id"], self.a.pk)                       # ... but the result still counts
        self.assertEqual(r["players"][str(self.n.pk)]["xp"], 15)


class TimerAndExpiryTests(TournamentBase):
    def test_a_late_answer_scores_zero_even_if_right(self):
        tour = self.declare(seconds=20)
        cur = T.play(tour.pk, self.a, self.t0)
        self.assertEqual(cur["seconds_total"], 20)
        late = self.t0 + timedelta(seconds=20 + 3)                       # beyond the limit and the network allowance
        nxt = T.answer(tour.pk, self.a, cur["question"]["id"], "b", late)
        p = TournamentPlay.objects.get(tournament=tour, user=self.a)
        self.assertEqual((p.answers[0]["fraction"], p.answers[0]["timed_out"], p.answers[0]["ms"]), (0.0, True, 20000))
        self.assertEqual(nxt["index"], 2)
        self.assertEqual(nxt["seconds_left"], 20)                        # the next clock starts when it is shown
        on_time = T.answer(tour.pk, self.a, nxt["question"]["id"], "b", late + timedelta(seconds=7))
        self.assertEqual(TournamentPlay.objects.get(pk=p.pk).answers[1]["fraction"], 1.0)

    def test_closing_the_app_does_not_stop_the_clock_and_reopening_does_not_reset_it(self):
        tour = self.declare(seconds=20)
        cur = T.play(tour.pk, self.a, self.t0)
        again = T.play(tour.pk, self.a, self.t0 + timedelta(seconds=8))  # reopened: same question, clock keeps running
        self.assertEqual((again["question"]["id"], again["seconds_left"]), (cur["question"]["id"], 12.0))
        back = T.play(tour.pk, self.a, self.t0 + timedelta(minutes=10))  # gone for ten minutes: that question timed out
        self.assertEqual(back["index"], 2)
        self.assertTrue(TournamentPlay.objects.get(tournament=tour, user=self.a).answers[0]["timed_out"])

    def test_repeated_send_and_out_of_order(self):
        tour = self.declare()
        cur = T.play(tour.pk, self.a, self.t0)
        qid = cur["question"]["id"]
        T.answer(tour.pk, self.a, qid, "b", self.t0 + timedelta(seconds=3))
        again = T.answer(tour.pk, self.a, qid, "a", self.t0 + timedelta(seconds=4))   # a double tap: ignored
        self.assertEqual(again["index"], 2)
        self.assertEqual(TournamentPlay.objects.get(tournament=tour, user=self.a).answers[0]["fraction"], 1.0)
        with self.assertRaises(services.GamificationError) as e:
            T.answer(tour.pk, self.a, 999999, "b", self.t0 + timedelta(seconds=5))
        self.assertEqual(e.exception.code, "out_of_order")

    def test_only_one_played_before_the_deadline_is_no_contest(self):
        tour = self.declare(hours=24)
        self.play_run(tour, self.a, "b", self.t0)
        after = tour.expires_at + timedelta(minutes=1)
        self.assertEqual(T.settle_due(after), 1)
        tour = Tournament.objects.get(pk=tour.pk)
        self.assertEqual((tour.status, tour.result["outcome"], tour.result["winner_id"]), ("expired", "no_contest", None))
        self.assertEqual((services.total_xp(self.a), services.total_xp(self.n)), (15, 0))   # play XP only, nobody wins
        self.assertFalse(BadgeAward.objects.filter(user=self.a, code="tournament_champion").exists())
        with self.assertRaises(services.GamificationError) as e:
            T.play(tour.pk, self.n, after)                                                     # too late to join
        self.assertEqual(e.exception.code, "closed")

    def test_nobody_played_pays_nothing_and_the_list_settles_it_lazily(self):
        tour = self.declare(hours=6)
        T.overview(self.n, tour.expires_at + timedelta(seconds=1))
        tour = Tournament.objects.get(pk=tour.pk)
        self.assertEqual((tour.status, tour.result["outcome"]), ("expired", "none"))
        self.assertEqual(XPEvent.objects.count(), 0)


class DeclineCancelTests(TournamentBase):
    def test_decline_and_cancel(self):
        tour = self.declare()
        self.assertEqual(T.detail(tour.pk, self.a)["can_cancel"], True)
        T.cancel(tour.pk, self.a)
        self.assertEqual(Tournament.objects.get(pk=tour.pk).status, "cancelled")
        tour = self.declare()
        T.decline(tour.pk, self.n)
        self.assertEqual(Tournament.objects.get(pk=tour.pk).status, "declined")
        self.assertEqual(Notification.objects.filter(user=self.a, kind="tournament_result").count(), 1)
        tour = self.declare()
        T.play(tour.pk, self.n, self.t0)                                  # once she has started she cannot decline,
        with self.assertRaises(services.GamificationError):
            T.decline(tour.pk, self.n)
        self.assertEqual(T.detail(tour.pk, self.a)["can_cancel"], False)  # ... and the challenger cannot cancel it


class InviteFeedTests(TournamentBase):
    def test_invites_feed_shows_only_what_is_waiting_for_her(self):
        ca, cn = self.client_for(self.a), self.client_for(self.n)
        self.assertEqual(cn.get("/api/tournaments/invites/").json()["invites"], [])
        tour = self.declare()
        got = cn.get("/api/tournaments/invites/").json()["invites"]
        self.assertEqual([(i["id"], i["opponent"]["name"], i["can_decline"]) for i in got], [(tour.pk, services.display_name(self.a, services.get_profile(self.a)), True)])
        self.assertEqual(ca.get("/api/tournaments/invites/").json()["invites"], [])      # the challenger has nothing waiting
        self.assertEqual(self.client_for(self.zawadi).get("/api/tournaments/invites/").json()["invites"], [])
        self.assertEqual(cn.post(f"/api/tournaments/{tour.pk}/decline/").status_code, 200)  # deny from the pop-up
        self.assertEqual(cn.get("/api/tournaments/invites/").json()["invites"], [])
        tour2 = self.declare()
        T.play(tour2.pk, self.n, self.t0)                                                  # once she has started it is no longer an invitation
        self.assertEqual(cn.get("/api/tournaments/invites/").json()["invites"], [])

    def test_an_expired_challenge_is_not_offered(self):
        tour = self.declare(hours=6)
        self.assertEqual(len(T.invites(self.n, self.t0 + timedelta(hours=1))), 1)
        self.assertEqual(T.invites(self.n, tour.expires_at + timedelta(minutes=1)), [])


class ApiFlowTests(TournamentBase):
    def test_a_whole_duel_through_the_api(self):
        ca, cn = self.client_for(self.a), self.client_for(self.n)
        opts = ca.get("/api/tournaments/options/").json()
        self.assertEqual([c["id"] for c in opts["classmates"]], [self.n.pk])
        self.assertEqual(opts["subjects"][0]["id"], self.maths.pk)
        made = ca.post("/api/tournaments/", {"subject_id": self.maths.pk, "opponent_id": self.n.pk, "count": 5, "seconds": 30, "hours": 24}, format="json")
        self.assertEqual(made.status_code, 201)
        tid = made.json()["id"]
        for client, answer in ((ca, "b"), (cn, "b")):
            cur = client.post(f"/api/tournaments/{tid}/play/").json()["current"]
            while cur:
                out = client.post(f"/api/tournaments/{tid}/answer/", {"question_id": cur["question"]["id"], "response": answer}, format="json").json()
                cur = out["current"]
        self.assertEqual(out["tournament"]["status"], "finished")
        self.assertEqual(out["tournament"]["result"]["outcome"] in ("won", "lost", "draw"), True)
        hist = cn.get("/api/tournaments/").json()
        self.assertEqual((len(hist["history"]), hist["record"]["played"]), (1, 1))
        bad = ca.post("/api/tournaments/", {"subject_id": self.maths.pk, "opponent_id": self.zawadi.pk, "count": 5, "seconds": 30, "hours": 24}, format="json")
        self.assertEqual((bad.status_code, bad.json()["code"]), (400, "not_classmate"))
