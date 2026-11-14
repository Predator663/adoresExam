"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon from "@/components/Icon";
import Shell from "@/components/Shell";
import { GradeMedal, Ring } from "@/components/student";
import { Bar, Confetti, CountUp, ErrorNote, Loading, useLoad, useNow, useQuery } from "@/components/ui";
import { api, downloadFile } from "@/lib/api";
import { clock, eatDate } from "@/lib/clock";
import { BADGE_EMOJI, TIER_MARK } from "@/lib/emoji";
import { resultMessageKey } from "@/lib/student";
import { useSession } from "@/lib/session";
import "@/components/result.css";

/** Fades a block in the first time it scrolls into view (shows at once when IntersectionObserver is missing). */
function Reveal({ children, className = "", d = 0, style }: { children: ReactNode; className?: string; d?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null), [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`rs-in ${on ? "in" : ""} ${className}`} style={{ "--d": `${d}ms`, ...style } as CSSProperties}>{children}</div>;
}

/** You and the class average on one 0–100 line. The markers slide in once the card is on screen. */
function Compare({ me, avg, label }: { me: number; avg: number; label: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const h = setTimeout(() => setOn(true), 350); return () => clearTimeout(h); }, []);
  const c = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <div className="rs-track" role="img" aria-label={label}>
      <i className="rs-fill" style={{ width: on ? `${c(me)}%` : 0 }} />
      <span className="rs-pin cls" style={{ left: on ? `${c(avg)}%` : 0 }}><i /><small>{Math.round(avg)}%</small></span>
      <span className="rs-pin me" style={{ left: on ? `${c(me)}%` : 0 }}><i /><small>{Math.round(me)}%</small></span>
    </div>
  );
}

/** RES-03: score, percentage, grade, time taken, anonymous class average, optional class position, XP and badges. */
function Detail({ id }: { id: number }) {
  const { t, lang } = useSession();
  const { data: d, error, err, loading, reload } = useLoad(() => api<any>(`/results/${id}/`), [id]);
  const [dl, setDl] = useState("");
  const now = useNow(1000);
  if (loading) return <Loading />;
  if (err?.code === "not_ready") {
    const at = err.data?.results_at ? new Date(err.data.results_at).getTime() : 0;
    return <div className="card center"><h2>{t("results_not_ready")}</h2>{at > now && <p className="big-num">{clock(at - now)}</p>}<p className="muted">{at ? t("results_at", { when: eatDate(err.data.results_at, undefined, lang) }) : ""}</p><button className="btn" onClick={reload}>{t("check_again")}</button></div>;
  }
  if (error || !d) return <ErrorNote error={error} retry={reload} />;
  const mins = Math.floor(d.time_taken_seconds / 60), secs = d.time_taken_seconds % 60;
  const pct = Math.round(d.percent), diff = Math.round(d.percent - d.class_average_percent);
  const weak = (d.topics || []).filter((x: any) => x.percent < 60).map((x: any) => x.topic);
  return (
    <>
      {d.passed && <Confetti once={`result-${id}`} />}
      <Link href="/results/" className="sx-back">← {t("nav_results")}</Link>
      <section className={`sx-rhero rs-hero ${d.passed ? "passed" : ""}`}>
        <i className="rs-blob" aria-hidden />
        <div className="sx-rhero-top"><span>{d.subject}</span></div>
        <h1>{d.exam}</h1>
        <div className="sx-rhero-body">
          <Ring value={pct} size={132} stroke={9} className="sx-rhero-ring" label={`${pct}%`}>
            <span className="sx-rhero-pct"><CountUp to={pct} />%</span>
            <span className="sx-rhero-score">{d.score}/{d.total}</span>
          </Ring>
          <div className="sx-rhero-side">
            <GradeMedal grade={d.grade} size={64} />
            <b className="sx-rhero-grade">{t("grade")} {d.grade} <span>({d.points} {t("points")})</span></b>
            <p className="sx-rhero-msg">{t(resultMessageKey(d.percent))}</p>
            <span className="sx-rhero-state">{d.passed ? `✓ ${t("passed")}` : t("keep_going")}</span>
          </div>
        </div>
      </section>

      <Reveal className="sx-stats rs-stats">
        <div className="sx-stat"><Icon n="clock" size={20} /><b>{mins}:{String(secs).padStart(2, "0")}</b><span>{t("time_taken")}</span></div>
        <div className="sx-stat"><Icon n="users" size={20} /><b><CountUp to={Math.round(d.class_average_percent)} />%</b><span>{t("class_average")}</span></div>
        {d.class_position && <div className="sx-stat"><Icon n="trophy" size={20} /><b>{d.class_position}/{d.class_size}</b><span>{t("class_position")}</span></div>}
      </Reveal>
      <Reveal className="card rs-cmp" d={80}>
        <h2>{t("class_average")}</h2>
        <Compare me={d.percent} avg={d.class_average_percent} label={`${pct}% / ${Math.round(d.class_average_percent)}%`} />
        <p className={`sx-vs ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`} role="status">{diff > 0 ? "▲ " : diff < 0 ? "▼ " : "● "}{diff === 0 ? t("at_class") : t(diff > 0 ? "above_class" : "below_class", { n: Math.abs(diff) })}</p>
      </Reveal>

      {d.rewards && (d.rewards.xp.length > 0 || d.rewards.badges.length > 0) && (
        <Reveal className="card sx-earned rs-earned" d={60}><h2>{t("you_earned")}</h2>
          <p className="big-num sx-xpnum rs-xp">⚡ +<CountUp to={d.rewards.xp_total} ms={1300} /> XP</p>
          <ul className="list">{d.rewards.xp.map((x: any, i: number) => <li key={i} className="row" style={{ "--i": i } as CSSProperties}><span className="grow">{x.label}</span><b>+{x.points}</b></li>)}</ul>
          {d.rewards.badges.length > 0 && <div className="rs-badges">{d.rewards.badges.map((b: any, i: number) => <p key={i} className="rs-badge" style={{ "--i": i } as CSSProperties}><span className="em" aria-hidden>{BADGE_EMOJI[b.code] || "🏅"}</span><span><b>{b.name}</b>{b.subject ? ` – ${b.subject}` : ""}<br /><span className="small muted">{TIER_MARK[b.tier]} {b.tier_label}</span></span></p>)}</div>}
        </Reveal>
      )}

      <Reveal className="card" d={60}><h2>{t("by_topic")}</h2>
        {d.topics.map((x: any, i: number) => {
          const strong = x.percent >= 60;
          return (
            <Reveal key={x.topic} d={i * 70} className={`sx-topic rs-topic ${strong ? "strong" : "weak"}`} style={{ "--w": `${Math.max(0, Math.min(100, x.percent))}%`, "--i": i } as CSSProperties}>
              <div className="row"><span className="grow">{x.topic}</span><span className="sx-topic-tag">{strong ? `✓ ${t("topic_strong")}` : `↗ ${t("topic_work")}`}</span><b>{Math.round(x.percent)}%</b></div>
              <Bar value={x.percent} label={x.topic} />
            </Reveal>
          );
        })}
        {d.revise?.length > 0 && <p className="hint"><b>{t("revise")}:</b> {d.revise.join(", ")}</p>}
        {weak.length > 0 && <Link className="btn sx-practice-cta" href="/practice/"><Icon n="pencil" size={18} /> {t("practise_now")}</Link>}
      </Reveal>

      <div className="sx-actions rs-actions">
        <Link className="btn primary big" href={`/review/?id=${id}`}><Icon n="file" size={18} /> {t("review_answers")}</Link>
        <button className="btn big" onClick={() => downloadFile(`/results/${id}/slip/?file=pdf`, `result-slip-${id}.pdf`).catch((e) => setDl(e.message))}><Icon n="download" size={18} /> {t("download_slip")}</button>
      </div>
      {dl && <p className="no" role="alert">{dl}</p>}
    </>
  );
}

export default function Result() {
  const id = useQuery("id");
  return <Shell>{id ? <Detail id={Number(id)} /> : <Loading />}</Shell>;
}
