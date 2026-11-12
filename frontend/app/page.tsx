"use client";
import Link from "next/link";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import HomeExams, { ExamsSkeleton } from "@/components/HomeExams";
import Icon from "@/components/Icon";
import Shell from "@/components/Shell";
import Tips from "@/components/Tips";
import { GradeMedal, Ring, Skeleton } from "@/components/student";
import { Bar, CountUp, ErrorNote, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { eatDate, makeOffset } from "@/lib/clock";
import { AVATAR_EMOJI, BADGE_EMOJI, TIER_MARK } from "@/lib/emoji";
import { greetKey } from "@/lib/student";
import { useSwr } from "@/lib/swr";
import { useSession } from "@/lib/session";
import type { ExamCard } from "@/lib/types";

type Summary = {
  xp: number; level: { level: number; name: string; next_name: string | null; progress_percent: number; xp_to_next: number };
  level_up: { from: number; to: number; name: string } | null;
  streak: { current: number; best: number; message: string; active_today: boolean; freezes_left_this_month: number };
  exam_streak: { current: number; best: number };
  recent_badges: { code: string; name: string; tier: string; tier_label: string; subject: string | null; new: boolean }[];
  new_badges: number; next_goals: { code: string; name: string; subject: string | null; progress: number; target: number; unit: string }[];
  profile?: { avatar?: string; display_name?: string };
};
type ResultRow = { attempt_id: number; exam: string; subject: string; percent: number; grade: string; date: string };
type Analytics = { subjects?: { subject: string; revise?: string[] }[] };

const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(ms));

/** One short, personal sentence: what matters most for this student right now. */
function useFocusLine(cards: ExamCard[] | null, s: Summary | null) {
  const { t } = useSession();
  return useMemo(() => {
    if (cards?.length) {
      const n = Date.now() + makeOffset(cards[0].server_time);
      if (cards.some((c) => c.state === "in_progress" || c.state === "open")) return t("focus_live");
      if (cards.some((c) => c.state === "upcoming" && dayKey(new Date(c.start_at).getTime()) === dayKey(n))) return t("focus_today");
    }
    if (s) {
      if (s.streak.current > 0 && !s.streak.active_today) return t("focus_streak_risk", { n: s.streak.current });
      if (s.level.next_name && s.level.xp_to_next > 0 && s.level.xp_to_next <= 150) return t("focus_level_close", { n: s.level.xp_to_next, name: s.level.next_name });
      if (s.streak.current >= 3) return t("focus_streak_good", { n: s.streak.current });
    }
    return t("focus_default");
  }, [cards, s, t]);
}

/** What a page-load skeleton needs to be: the same shapes as the real thing, so nothing jumps when the data arrives. */
const rv = (i: number) => ({ "--i": i }) as CSSProperties;
/** A cached exam card's server clock is as old as the cache: move it forward by that age so countdowns stay right. */
const ageCards = (cards: ExamCard[], ms: number) => (Array.isArray(cards) ? cards.map((c) => ({ ...c, server_time: new Date(new Date(c.server_time).getTime() + ms).toISOString() })) : cards);

function SideSkeleton() {
  return (
    <div className="ux-skel-side" aria-busy="true">
      <Skeleton h={150} r={22} /><Skeleton h={110} r={22} /><Skeleton h={130} r={22} />
    </div>
  );
}

function StudentHome() {
  const { user, t, lang } = useSession();
  const uid = user?.id ?? 0;
  const exams = useSwr<ExamCard[]>(`home:exams:${uid}`, () => api<ExamCard[]>("/student/exams/"), { age: ageCards });
  const sum = useSwr<Summary>(`home:sum:${uid}`, () => api<Summary>("/gamification/me/"));
  const res = useSwr<ResultRow[]>(`home:res:${uid}`, () => api<ResultRow[]>("/results/"));
  const ana = useSwr<Analytics>(`home:ana:${uid}`, () => api<Analytics>("/student/analytics/"));
  const [celebrate, setCelebrate] = useState(false);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => { if (sum.data && !sum.refreshing && (sum.data.level_up || sum.data.new_badges > 0)) setCelebrate(true); }, [sum.data, sum.refreshing]);  // only from fresh data, never from the cached copy
  useEffect(() => { setStandalone(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true); }, []);
  const ack = () => { setCelebrate(false); if (sum.data) sum.setData({ ...sum.data, level_up: null, new_badges: 0 }); api("/gamification/ack/", { method: "POST", body: {} }).catch(() => {}); };

  const s = sum.data;
  const focus = useFocusLine(exams.data, s);
  const name = (s?.profile?.display_name || "").trim() || user!.first_name || user!.username;
  const avatar = AVATAR_EMOJI[s?.profile?.avatar || ""] || "🦉";
  const fresh = Array.isArray(res.data) ? res.data.slice(0, 3) : [];
  const revise = useMemo(() => {
    const out: { topic: string; subject: string }[] = [];
    (ana.data?.subjects || []).forEach((x) => (x.revise || []).forEach((topic) => out.push({ topic, subject: x.subject })));
    return out.slice(0, 4);
  }, [ana.data]);

  return (
    <div className="sx-home">
      <div className="sx-main">
        <section className="ux-hero" aria-label={t(greetKey())}>
          <i className="ux-hero-blob b1" aria-hidden /><i className="ux-hero-blob b2" aria-hidden />
          <div className="ux-hero-row">
            <Ring value={s?.level.progress_percent ?? 0} size={92} stroke={5} className="sx-hero-ring ux-hero-ring" label={s ? t("xp_progress") : undefined}>
              <span className="ux-avatar" aria-hidden>{avatar}</span>
            </Ring>
            <div className="ux-hero-text">
              <p className="ux-greet">{t(greetKey())}</p>
              <h1 className="ux-name">{name} <span className="wave" aria-hidden>👋</span></h1>
              <p className="ux-focus" key={focus}>{focus}</p>
            </div>
          </div>
          {s ? (
            <>
              <ul className="ux-stats" aria-label={t("my_progress")}>
                <li style={rv(0)}><span aria-hidden className={s.streak.current > 0 ? "flame" : ""}>{s.streak.current > 0 ? "🔥" : "🕯️"}</span><b><CountUp to={s.streak.current} /></b><small>{t("streak_short")}</small></li>
                <li style={rv(1)}><Icon n="medal" size={20} /><b>{s.level.level}</b><small>{s.level.name}</small></li>
                <li style={rv(2)}><Icon n="zap" size={20} /><b><CountUp to={s.xp} /></b><small>XP</small></li>
              </ul>
              <div className="ux-xp" style={rv(3)}>
                <div className="ux-xp-bar" role="progressbar" aria-valuenow={Math.round(s.level.progress_percent)} aria-valuemin={0} aria-valuemax={100} aria-label={t("xp_progress")}><i style={{ width: `${Math.max(2, Math.min(100, s.level.progress_percent))}%` }} /></div>
                <small>{s.level.next_name ? t("xp_to_next", { n: s.level.xp_to_next, name: s.level.next_name }) : t("top_level")}</small>
              </div>
            </>
          ) : (
            <div className="ux-stats-skel" aria-hidden><span className="ux-sk" /><span className="ux-sk" /><span className="ux-sk" /></div>
          )}
        </section>

        <Tips />

        {exams.loading ? <ExamsSkeleton /> : exams.error ? <ErrorNote error={exams.error} retry={exams.reload} /> : <div className="ux-fade"><HomeExams cards={exams.data || []} /></div>}

        <nav className="sx-quick ux-quick" aria-label={t("quick_links")}>
          {([["/practice/", "pencil", t("nav_practice")], ["/progress/", "trend", t("my_analytics")], ["/badges/", "medal", t("nav_badges")], ["/leaderboard/", "trophy", t("leaderboard")]] as [string, string, string][]).map(([h, ic, l], i) => (
            <Link key={h} href={h} className="sx-tile" style={rv(i)}><span className="sx-tile-ico"><Icon n={ic} size={22} /></span><span>{l}</span></Link>
          ))}
        </nav>
      </div>

      <aside className="sx-side ux-side">
        {fresh.length > 0 && (
          <section>
            <div className="sx-sec"><h2>{t("results_ready")}</h2><Link href="/results/">{t("see_all")}</Link></div>
            <ul className="list card sx-results">
              {fresh.map((r) => (
                <li key={r.attempt_id}>
                  <Link href={`/result/?id=${r.attempt_id}`} className="sx-row">
                    <GradeMedal grade={r.grade} size={42} />
                    <span className="grow"><b>{r.exam}</b><br /><span className="muted small">{r.subject} · {eatDate(r.date, { day: "numeric", month: "short" }, lang)}</span></span>
                    <b className="sx-pct">{Math.round(r.percent)}%</b>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {revise.length > 0 && (
          <section className="card sx-revise">
            <h2>{t("revise_next")}</h2>
            <p className="muted small">{t("revise_hint")}</p>
            <div className="sx-tags">{revise.map((x, i) => <Link key={i} href="/practice/" className="sx-tag" title={x.subject}><span className="muted">{x.subject}</span> {x.topic}</Link>)}</div>
          </section>
        )}

        {sum.loading ? <SideSkeleton /> : s ? (
          <>
            <section className="card sx-level">
              <div className="row"><b>{t("level_n", { n: s.level.level })} · {s.level.name}</b><span className="grow" /><b><CountUp to={s.xp} /> XP</b></div>
              <Bar value={s.level.progress_percent} label={t("xp_progress")} />
              <p className="muted small">{s.level.next_name ? t("xp_to_next", { n: s.level.xp_to_next, name: s.level.next_name }) : t("top_level")}</p>
              <p className="muted small">{t("best_streak", { n: s.streak.best })} · {t("freezes_left", { n: s.streak.freezes_left_this_month })}</p>
            </section>
            {s.next_goals.length > 0 && (
              <section className="card"><h2>{t("next_goals")}</h2>
                {s.next_goals.map((g, i) => (
                  <div key={i} className="sx-goal"><div className="small"><b>{g.name}</b>{g.subject ? ` · ${g.subject}` : ""}<span className="muted"> {g.progress}/{g.target} {g.unit}</span></div><Bar value={g.target > 0 ? (g.progress / g.target) * 100 : 0} label={g.name} /></div>
                ))}
              </section>
            )}
            {s.recent_badges.length > 0 && (
              <section className="card">
                <div className="sx-sec flat"><h2>{t("recent_badges")}</h2><Link href="/badges/">{t("see_all")}</Link></div>
                <div className="grid3">
                  {s.recent_badges.map((b, i) => (
                    <div key={i} className={`badge-tile tier-${b.tier}`}><span className="em" aria-hidden>{BADGE_EMOJI[b.code] || "🏅"}</span><b className="small">{b.name}</b>{b.subject && <div className="small muted">{b.subject}</div>}<div className="small">{TIER_MARK[b.tier]} {b.tier_label}</div></div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : sum.error ? <ErrorNote error={sum.error} retry={sum.reload} /> : null}

        <p className="center-text sx-foot-links">
          {!standalone && <Link href="/install/"><Icon n="download" size={15} /> {t("install_app")}</Link>}
          <Link href="/demo/">{t("try_demo")}</Link>
        </p>
      </aside>

      {celebrate && s && (
        <Modal label={t("well_done")} onClose={ack}>
          <div className="center pop">
            <span className="big-num" aria-hidden>🎉</span>
            <h2>{t("well_done")}</h2>
            {s.level_up && <p><b>{t("level_up", { name: s.level_up.name, n: s.level_up.to })}</b></p>}
            {s.recent_badges.filter((b) => b.new).map((b, i) => <p key={i}>{BADGE_EMOJI[b.code]} {t("new_badge", { name: b.name })}</p>)}
            <button className="btn primary" onClick={ack}>{t("thanks")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function Home() {
  const { user, t } = useSession();
  useEffect(() => { if (user && user.role !== "student") location.replace("/staff/"); }, [user]);
  return (
    <Shell>
      {user?.role === "student" ? <StudentHome /> : (
        <div className="card center">
          <h1>{t("staff_notice_title")}</h1>
          <p>{t("staff_notice")}</p>
          <Link className="btn primary" href="/staff/">{t("open_staff")}</Link>
        </div>
      )}
    </Shell>
  );
}
