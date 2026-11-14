"use client";
/* Building blocks for the practice page: today's goal, quiz length, subject tiles, progress segments, feedback and the
   celebration at the end. Texts that only this page uses live here in English and Kiswahili. */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Monogram, Ring } from "./student";
import { Bar, Confetti, CountUp } from "./ui";
import { BADGE_EMOJI } from "@/lib/emoji";
import { useSession } from "@/lib/session";
import "./practice.css";

const TXT = {
  en: { today: "Today", xpEach: "+{xp} XP each", goalOf: "{a} of {b} XP quizzes done today", goalDone: "Daily XP goal reached. Extra quizzes still keep you learning!", streak: "day streak", keep: "Practise today to keep your streak!",
    level: "Level", toGo: "{n} XP to {name}", maxLevel: "Top level!", nextBadge: "Next badge", len: "How long?", lenQ: "questions", lenMin: "about {n} min", pick: "Choose a subject",
    newS: "New", mastered: "Mastered", getting: "Getting there", keepOn: "Keep going", quizzes: "quizzes", best: "best", cont: "Continue", start: "Start", starting: "Starting…", leave: "Leave quiz", saved: "Your progress is saved.",
    inRow: "{n} in a row!", check: "Check answer", next: "Next question", see: "See my results", again: "Practise again", back: "Back to subjects", levelUp: "Level up!", newBadges: "New badges!", seeBadges: "See all my badges",
    big: ["Outstanding!", "Well done!", "Good effort!", "Keep going, you are learning!"], right: "{a} of {b} right", bestRun: "Best run", xp: "XP", noXp: "No XP now (daily limit)", streakNow: "Streak" },
  sw: { today: "Leo", xpEach: "+{xp} XP kila moja", goalOf: "Mazoezi {a} kati ya {b} ya XP leo", goalDone: "Lengo la XP la leo limefikiwa. Mazoezi zaidi bado yanakusaidia kujifunza!", streak: "siku mfululizo", keep: "Fanya mazoezi leo ili usipoteze mfululizo wako!",
    level: "Kiwango", toGo: "XP {n} hadi {name}", maxLevel: "Kiwango cha juu!", nextBadge: "Beji inayofuata", len: "Muda gani?", lenQ: "maswali", lenMin: "kama dakika {n}", pick: "Chagua somo",
    newS: "Jipya", mastered: "Umelimudu", getting: "Unaelekea", keepOn: "Endelea", quizzes: "mazoezi", best: "bora", cont: "Endelea", start: "Anza", starting: "Inaanza…", leave: "Ondoka", saved: "Maendeleo yako yamehifadhiwa.",
    inRow: "{n} mfululizo!", check: "Hakiki jibu", next: "Swali linalofuata", see: "Ona matokeo yangu", again: "Fanya tena", back: "Rudi kwenye masomo", levelUp: "Umepanda kiwango!", newBadges: "Beji mpya!", seeBadges: "Ona beji zangu zote",
    big: ["Hongera sana!", "Umefanya vizuri!", "Juhudi nzuri!", "Endelea, unajifunza!"], right: "Sahihi {a} kati ya {b}", bestRun: "Mfululizo bora", xp: "XP", noXp: "Hakuna XP sasa (kikomo cha siku)", streakNow: "Mfululizo" },
} as const;
export function usePT() {
  const { lang } = useSession();
  const d = TXT[lang === "sw" ? "sw" : "en"];
  const f = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
  return { d, f, lang };
}
export const buzz = (ms: number | number[]) => { try { if (!document.documentElement.classList.contains("reduce-motion")) navigator.vibrate?.(ms); } catch { /* not supported: fine */ } };

/* ----------------------------------------------------------------------------------------------- hub */
export function Hero({ o }: { o: any }) {
  const { d, f } = usePT(), lv = o.level, cap = Math.max(1, Math.min(o.daily_cap || 1, 10)), done = Math.min(o.xp_quizzes_today || 0, cap), nb = o.next_badge;
  return (
    <section className="pr-hero" aria-label={d.today}>
      <i className="pr-blob a" aria-hidden /><i className="pr-blob b" aria-hidden />
      <div className="pr-hero-top">
        <Ring value={lv.progress_percent} size={84} stroke={7} className="pr-ring" label={`${d.level} ${lv.level}`}><span className="pr-lv"><small>{d.level}</small><b>{lv.level}</b></span></Ring>
        <div className="pr-hero-txt">
          <b className="pr-lvname">{lv.name}</b>
          <span>{lv.next_name ? f(d.toGo, { n: lv.xp_to_next, name: lv.next_name }) : d.maxLevel}</span>
        </div>
        <div className={`pr-flame ${o.streak.current ? "lit" : ""}`} title={d.streak}><span aria-hidden>🔥</span><b><CountUp to={o.streak.current} /></b><small>{d.streak}</small></div>
      </div>
      {o.streak.at_risk && o.streak.current > 0 && <p className="pr-risk" role="status">⏳ {d.keep}</p>}
      <div className="pr-goal">
        <div className="pr-dots" role="img" aria-label={f(d.goalOf, { a: done, b: cap })}>{Array.from({ length: cap }, (_, i) => <i key={i} className={i < done ? "on" : ""} style={{ animationDelay: `${i * 80}ms` }}>{i < done ? "✓" : ""}</i>)}</div>
        <span className="pr-goal-t">{done >= cap ? d.goalDone : f(d.goalOf, { a: done, b: cap })} <small>· {f(d.xpEach, { xp: o.xp_per_quiz })}</small></span>
      </div>
      {nb && (
        <div className="pr-next">
          <span className="pr-next-ic" aria-hidden>{BADGE_EMOJI[nb.code] || "🏅"}</span>
          <div className="grow"><div className="row small"><b className="grow">{d.nextBadge}: {nb.name}</b><span>{nb.progress}/{nb.target}</span></div><Bar value={(nb.progress / nb.target) * 100} label={nb.name} /></div>
        </div>
      )}
    </section>
  );
}

export function LengthPicker({ value, onChange, xp }: { value: number; onChange: (n: number) => void; xp: number }) {
  const { d, f } = usePT(), opts = [5, 10, 15, 20], at = Math.max(0, opts.indexOf(value));
  return (
    <div className="pr-len card">
      <div className="row"><b className="grow">{d.len}</b><span className="muted small">{f(d.lenMin, { n: Math.max(1, Math.round(value * 0.6)) })} · +{xp} XP</span></div>
      <div className="pr-seg" role="radiogroup" aria-label={d.len}>
        <i className="pr-seg-ind" style={{ transform: `translateX(${at * 100}%)` }} aria-hidden />
        {opts.map((n) => <button key={n} type="button" role="radio" aria-checked={n === value} className={n === value ? "on" : ""} onClick={() => onChange(n)}><b>{n}</b><small>{d.lenQ}</small></button>)}
      </div>
    </div>
  );
}

export function SubjectTile({ s, i, busy, saved, why, onStart }: { s: any; i: number; busy: boolean; saved: boolean; why?: string; onStart: () => void }) {
  const { d } = usePT(), st = s.stats || {}, pct = st.recent_percent as number | null | undefined;
  const label = pct == null ? d.newS : pct >= 85 ? d.mastered : pct >= 60 ? d.getting : d.keepOn;
  return (
    <article className={`pr-tile ${s.can_start ? "" : "off"} ${pct == null ? "" : pct >= 85 ? "great" : pct >= 60 ? "ok" : "low"}`} style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}>
      <div className="pr-tile-top">
        <Monogram name={s.name} size={46} />
        <span className="grow"><b className="pr-tile-name">{s.name}</b><small className="muted">{s.available_questions} ✎</small></span>
        <Ring value={pct ?? 0} size={54} stroke={5} className="pr-tile-ring" label={pct == null ? undefined : `${pct}%`}><span className="pr-tile-pct">{pct == null ? "–" : `${pct}`}</span></Ring>
      </div>
      <div className="pr-tile-meta"><span className="pr-chip">{label}</span>{st.quizzes > 0 && <span className="muted small">{st.quizzes} {d.quizzes} · {d.best} {st.best_percent}%</span>}{saved && <span className="ok small">✓ ↓</span>}</div>
      {s.in_progress && <div className="pr-resume"><Bar value={(s.in_progress.answered / Math.max(1, s.in_progress.total)) * 100} label={d.cont} /><small className="muted">{s.in_progress.answered}/{s.in_progress.total}</small></div>}
      {!s.can_start && why && <p className="no small pr-why">{why}</p>}
      <button className="btn primary pr-go" disabled={!s.can_start || busy} onClick={onStart}>{busy ? <><i className="spinner" aria-hidden /> {d.starting}</> : s.in_progress ? `▶ ${d.cont}` : `▶ ${d.start}`}</button>
    </article>
  );
}

/* ----------------------------------------------------------------------------------------------- playing */
export function Segments({ total, answered, results }: { total: number; answered: number; results: ("right" | "part" | "wrong" | undefined)[] }) {
  return (
    <div className="pr-segs" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < answered ? `done ${results[i] || ""}` : i === answered ? "cur" : ""} />)}
    </div>
  );
}

export function Feedback({ fb, combo, children }: { fb: any; combo: number; children?: ReactNode }) {
  const { d, f } = usePT(), kind = fb.correct ? "right" : fb.fraction > 0 ? "part" : "wrong";
  return (
    <div className={`card pr-fb ${kind}`} role="status">
      <div className="pr-fb-head">
        <span className="pr-fb-ico" aria-hidden>{kind === "right" ? <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : kind === "part" ? "◐" : <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>}</span>
        <h2>{fb.message}</h2>
      </div>
      {combo >= 2 && fb.correct && <p className="pr-combo" key={combo}>🔥 {f(d.inRow, { n: combo })}</p>}
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- summary */
export function Summary({ m, rewards, combo, sessionId, onAgain, onExit }: { m: { questions: number; fully_correct: number; score_percent: number; xp_earned: number }; rewards?: any; combo: number; sessionId: number; onAgain: () => void; onExit: () => void }) {
  const { d, f } = usePT(), [shown, setShown] = useState(0), p = m.score_percent;
  useEffect(() => { const h = setTimeout(() => setShown(p), 250); return () => clearTimeout(h); }, [p]);
  const badges: any[] = rewards?.badges || [], title = p >= 90 ? d.big[0] : p >= 70 ? d.big[1] : p >= 50 ? d.big[2] : d.big[3];
  return (
    <div className="pr-sum">
      {(p >= 70 || badges.length > 0 || rewards?.level_up) && <Confetti once={`practice-${sessionId}`} />}
      <div className="card hero center pr-sum-hero">
        <Ring value={shown} size={132} stroke={9} className="sx-rhero-ring" label={`${p}%`}><span className="sx-rhero-pct"><CountUp to={p} ms={1200} suffix="%" /></span></Ring>
        <h1>{title}</h1>
        <p>{f(d.right, { a: m.fully_correct, b: m.questions })}</p>
        <div className="pr-sum-chips">
          <span className="pr-sum-chip xp">⚡ {m.xp_earned > 0 ? <b>+<CountUp to={m.xp_earned} /> {d.xp}</b> : <small>{d.noXp}</small>}</span>
          {rewards?.streak?.current > 0 && <span className="pr-sum-chip">🔥 <b>{rewards.streak.current}</b> <small>{d.streak}</small></span>}
          {combo >= 3 && <span className="pr-sum-chip">🎯 <b>{combo}</b> <small>{d.bestRun}</small></span>}
        </div>
      </div>
      {rewards?.level_up && (
        <div className="card pr-levelup" role="status"><span aria-hidden>🚀</span><div><b>{d.levelUp}</b><br />{d.level} {rewards.level_up.level} · {rewards.level_up.name}</div></div>
      )}
      {badges.length > 0 && (
        <section aria-label={d.newBadges}>
          <h2 className="pr-sum-h">🏅 {d.newBadges}</h2>
          <div className="pr-badges">
            {badges.map((b, i) => (
              <div key={b.code + b.scope} className={`pr-badge t-${b.tier}`} style={{ animationDelay: `${0.5 + i * 0.25}s` }}>
                <span className="pr-badge-ic" aria-hidden>{BADGE_EMOJI[b.code] || "🏅"}</span>
                <b>{b.name}{b.subject ? ` · ${b.subject}` : ""}</b><small>{b.tier_label}</small><span className="muted small">{b.description}</span><i className="pr-shine" aria-hidden />
              </div>
            ))}
          </div>
          <p><Link className="btn ghost" href="/badges/">{d.seeBadges} →</Link></p>
        </section>
      )}
      <div className="pr-sum-actions"><button className="btn primary big" onClick={onAgain}>↻ {d.again}</button><button className="btn big" onClick={onExit}>{d.back}</button></div>
    </div>
  );
}
