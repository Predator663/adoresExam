"use client";
import "./tournament.css";
import { useCallback, useEffect, useRef, useState } from "react";
import QTimer from "@/components/QTimer";
import QuestionView, { hasAnswer, initialValue } from "@/components/QuestionView";
import { PageSkeleton } from "@/components/student";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import { AVATAR_EMOJI } from "@/lib/emoji";
import { useMine } from "@/lib/mine";
import { InviteSection } from "@/components/TournamentInvites";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";

const TXT = {
  en: {
    title: "Tournaments", intro: "Challenge any student, from any class. You both answer the same timed questions whenever you like before the deadline. Beat a higher class for bonus XP, but losing to a lower class costs XP.",
    challenge: "Challenge a classmate", won: "Won", lost: "Lost", drawn: "Drawn", played: "Played", invites: "Invitations for you", active: "In play", history: "Finished",
    none: "Nothing here yet.", vs: "vs", expires: "Ends {when}", ago: "ended", left_h: "{n} h left", left_m: "{n} min left", left_d: "{n} days left", over: "Time is up",
    you_play: "Your turn to play", waiting_for: "Waiting for {name} to play", you_done: "You have finished", they_done: "{name} has played", theyre_playing: "{name} has started",
    play: "Play now", continue: "Continue", start: "Start", decline: "Decline", cancel: "Cancel this challenge", back: "Back", refresh: "Refresh",
    pick_subject: "Subject", pick_who: "Classmate", pick_count: "Questions", pick_secs: "Seconds for each question", pick_hours: "Time to finish", hours_unit: "hours",
    declare: "Send the challenge", no_classmates: "No classmates are available to challenge yet.", no_subjects: "No subject has enough practice questions yet.", questions: "questions",
    rules: "How it works", r1: "You and your classmate get the same {n} questions, in a different order each.", r2: "Every question has {s} seconds. The clock keeps running even if you leave, and a late answer scores 0.",
    r3: "Correct answers are not shown now. Everything is revealed when both of you have finished.", r4: "The higher score wins. If it is equal, the faster total time wins.",
    r5: "You must finish before {when}. If your classmate does not, nobody wins.", ready: "Ready?", lock: "Lock in answer", answer_first: "Choose an answer, or wait for the time to run out.", time: "Time left",
    q_of: "Question {x} of {y}", saving: "Sending…", res_won: "You won!", res_lost: "{name} won this one", res_draw: "It is a draw!", res_no: "No result", res_none: "Nobody played in time",
    by_score: "Decided by score", by_time: "Same score, decided by the faster time", no_contest_note: "The tournament ended before both of you finished, so nobody wins.",
    correct: "correct", total_time: "total time", you: "You", xp_earned: "+{n} XP", no_xp: "No XP (daily tournament limit reached)", badges: "New badges", review: "Question by question", rematch: "Challenge again",
    declined: "Declined", cancelled: "Cancelled", s: "s", timed_out: "time out", leave: "Leave? Your clock keeps running.",
  },
  sw: {
    title: "Mashindano", intro: "Mpe changamoto mwanafunzi yeyote wa darasa lolote. Nyote mnajibu maswali yale yale yenye saa, wakati wowote kabla ya muda kuisha. Ukimshinda wa darasa la juu unapata XP ya ziada, ukishindwa na wa darasa la chini unapoteza XP.",
    challenge: "Mpe changamoto mwenzako", won: "Ushindi", lost: "Kushindwa", drawn: "Sare", played: "Yaliyochezwa", invites: "Mialiko kwako", active: "Yanayoendelea", history: "Yaliyokwisha",
    none: "Bado hakuna kitu hapa.", vs: "dhidi ya", expires: "Yanaisha {when}", ago: "yaliisha", left_h: "Saa {n} zimebaki", left_m: "Dakika {n} zimebaki", left_d: "Siku {n} zimebaki", over: "Muda umeisha",
    you_play: "Zamu yako kucheza", waiting_for: "Inamsubiri {name} acheze", you_done: "Umemaliza", they_done: "{name} amecheza", theyre_playing: "{name} ameanza",
    play: "Cheza sasa", continue: "Endelea", start: "Anza", decline: "Kataa", cancel: "Ghairi changamoto hii", back: "Rudi", refresh: "Onyesha upya",
    pick_subject: "Somo", pick_who: "Mwanafunzi mwenzako", pick_count: "Idadi ya maswali", pick_secs: "Sekunde kwa kila swali", pick_hours: "Muda wa kumaliza", hours_unit: "saa",
    declare: "Tuma changamoto", no_classmates: "Bado hakuna wanafunzi wenzako wa kupewa changamoto.", no_subjects: "Bado hakuna somo lenye maswali ya mazoezi ya kutosha.", questions: "maswali",
    rules: "Inavyofanya kazi", r1: "Wewe na mwenzako mnapata maswali {n} yale yale, kila mmoja kwa mpangilio tofauti.", r2: "Kila swali lina sekunde {s}. Saa inaendelea hata ukitoka, na jibu la kuchelewa linapata 0.",
    r3: "Majibu sahihi hayaonyeshwi sasa. Kila kitu kinaonyeshwa mkishamaliza nyote wawili.", r4: "Alama nyingi zinashinda. Zikilingana, muda mfupi zaidi unashinda.",
    r5: "Lazima umalize kabla ya {when}. Mwenzako asipomaliza, hakuna mshindi.", ready: "Uko tayari?", lock: "Thibitisha jibu", answer_first: "Chagua jibu, au subiri muda uishe.", time: "Muda uliobaki",
    q_of: "Swali {x} kati ya {y}", saving: "Inatuma…", res_won: "Umeshinda!", res_lost: "{name} ameshinda hili", res_draw: "Ni sare!", res_no: "Hakuna matokeo", res_none: "Hakuna aliyecheza kwa wakati",
    by_score: "Imeamuliwa kwa alama", by_time: "Alama sawa, imeamuliwa kwa muda mfupi zaidi", no_contest_note: "Mashindano yaliisha kabla hamjamaliza nyote, kwa hiyo hakuna mshindi.",
    correct: "sahihi", total_time: "muda wote", you: "Wewe", xp_earned: "+XP {n}", no_xp: "Hakuna XP (umefikia kikomo cha mashindano cha leo)", badges: "Beji mpya", review: "Swali kwa swali", rematch: "Mpe changamoto tena",
    declined: "Yamekataliwa", cancelled: "Yamefutwa", s: "s", timed_out: "muda uliisha", leave: "Kutoka? Saa yako inaendelea.",
  },
};
const EXTRA = {
  en: {
    arena: "Arena", cta: "Challenge someone", win_rate: "Win rate", live: "Live", finished: "Finished", search_ph: "Search a student by name…", search_hint: "Type at least 2 letters. You can challenge any class.",
    recent: "Recent opponents", any_class: "All classes", form_n: "Form {n}", no_results: "Nobody found. Check the spelling.", searching: "Searching…", step1: "Who", step2: "Match", next: "Next",
    picked: "Your opponent", change: "Change", pick_first: "Pick an opponent first", sent: "Challenge sent!", sent_sub: "{name} has {h} hours to take it on. You can play your part right now.", play_mine: "Play my turn now", later_btn: "Later",
    stake_up: "Win = +{n}% XP", stake_down: "Lose = −{n} XP", stake_even: "Same class level", stake_safe: "Losing costs no XP", win_pays: "A win pays {n}%",
    why_up: "{name} is in a higher class. If you win you earn {n}% more XP. If you lose, you lose nothing.",
    why_down: "{name} is in a lower class. A win pays only {win}% of the usual XP, and losing costs you {n} XP.",
    why_even: "You are in the same class level, so XP is normal.", why_questions: "Questions come from the lower of your two classes, so both of you have studied them.",
    bonus: "Class bonus +{n}%", reduced: "Lower-class win: {n}% XP", penalty_lbl: "Penalty −{n} XP", lost_xp: "−{n} XP", empty_title: "No battles yet", empty_sub: "Pick a classmate or any student from another class and send the first challenge.",
    left_lbl: "left", class_lbl: "Class", sent_to: "Sent to {name}", gap_note: "{n} class(es) apart",
  },
  sw: {
    arena: "Uwanja", cta: "Mpe mtu changamoto", win_rate: "Asilimia ya ushindi", live: "Yanayoendelea", finished: "Yaliyokwisha", search_ph: "Tafuta mwanafunzi kwa jina…", search_hint: "Andika herufi 2 au zaidi. Unaweza kumpa changamoto darasa lolote.",
    recent: "Waliocheza nawe hivi karibuni", any_class: "Madarasa yote", form_n: "Kidato {n}", no_results: "Hakuna aliyepatikana. Kagua tahajia.", searching: "Inatafuta…", step1: "Nani", step2: "Mchezo", next: "Endelea",
    picked: "Mpinzani wako", change: "Badilisha", pick_first: "Chagua mpinzani kwanza", sent: "Changamoto imetumwa!", sent_sub: "{name} ana saa {h} za kuikubali. Unaweza kucheza zamu yako sasa hivi.", play_mine: "Cheza zamu yangu sasa", later_btn: "Baadaye",
    stake_up: "Ushindi = +{n}% XP", stake_down: "Kushindwa = −XP {n}", stake_even: "Darasa sawa", stake_safe: "Kushindwa hakupunguzi XP", win_pays: "Ushindi unalipa {n}%",
    why_up: "{name} yuko darasa la juu. Ukishinda unapata XP zaidi kwa {n}%. Ukishindwa hupotezi kitu.",
    why_down: "{name} yuko darasa la chini. Ushindi unalipa {win}% tu ya XP ya kawaida, na kushindwa kunakugharimu XP {n}.", why_even: "Mko darasa moja, kwa hiyo XP ni ya kawaida.",
    why_questions: "Maswali yanatoka darasa la chini kati ya yenu wawili, ili nyote mmeyasoma.",
    bonus: "Bonasi ya darasa +{n}%", reduced: "Ushindi dhidi ya darasa la chini: {n}% XP", penalty_lbl: "Adhabu −XP {n}", lost_xp: "−XP {n}", empty_title: "Bado hakuna mapambano", empty_sub: "Chagua mwanafunzi yeyote, hata wa darasa lingine, utume changamoto ya kwanza.",
    left_lbl: "zimebaki", class_lbl: "Darasa", sent_to: "Imetumwa kwa {name}", gap_note: "madarasa {n} tofauti",
  },
};
type Dict = typeof TXT.en & typeof EXTRA.en;
const useT = () => {
  const { lang } = useSession();
  const k = lang === "sw" ? "sw" : "en";
  const d: Dict = { ...TXT[k], ...EXTRA[k] };
  const f = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
  return { d, f };
};

type Stakes = { gap: number; win_pct: number; penalty: number };
type Person = { id: number; name: string; avatar: string; status?: string; form?: number | null; class_name?: string; stakes?: Stakes };
type Row = { prompt: string; me: number; opponent: number; me_ms: number; opponent_ms: number };
type Tour = {
  id: number; subject: string; status: string; question_count: number; seconds_per_question: number; expires_at: string; created_at?: string; stakes?: Stakes; role: string; me: Person; opponent: Person;
  can_play: boolean; can_decline: boolean; can_cancel: boolean;
  result?: { outcome: string; how: string; me: { correct: number; total: number; time_ms: number; xp: number; penalty?: number; win_pct?: number } | null; opponent: { correct: number; total: number; time_ms: number } | null; badges: { name: string; tier_label: string }[]; questions?: Row[] };
};
type Cur = { index: number; total: number; seconds_total: number; seconds_left: number; question: Question };

const Av = ({ p, big, huge }: { p: Person; big?: boolean; huge?: boolean }) => <span className={`tn-av${big ? " big" : ""}${huge ? " huge" : ""}`} aria-hidden>{AVATAR_EMOJI[p.avatar] || "🙂"}</span>;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}`;

function useLeft(iso: string) {
  const { d, f } = useT();
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return d.over;
  const m = Math.round(ms / 60000);
  return m < 90 ? f(d.left_m, { n: Math.max(1, m) }) : m < 60 * 36 ? f(d.left_h, { n: Math.round(m / 60) }) : f(d.left_d, { n: Math.round(m / 1440) });
}


const reduced = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion"));
function Count({ to, ms = 800 }: { to: number; ms?: number }) {
  const [v, setV] = useState(reduced() ? to : 0);
  useEffect(() => {
    if (reduced()) { setV(to); return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{v}</>;
}

/** What the class gap does to ME, in one short chip. Up = a bigger win bonus, down = a smaller one plus a penalty for losing. */
function Stake({ s }: { s?: Stakes }) {
  const { d, f } = useT();
  if (!s || s.gap === 0) return <span className="tn-stake even">⚖️ {d.stake_even}</span>;
  if (s.gap > 0) return <span className="tn-stake up">🔥 {f(d.stake_up, { n: s.win_pct - 100 })} <small>· {d.stake_safe}</small></span>;
  return <span className="tn-stake down">⚠️ {f(d.stake_down, { n: s.penalty })} <small>· {f(d.win_pays, { n: s.win_pct })}</small></span>;
}
const Confetti = () => <div className="tn-confetti" aria-hidden>{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ ["--x" as any]: `${(i * 37) % 100}%`, ["--d" as any]: `${(i % 7) * 0.12}s`, ["--h" as any]: `${(i * 47) % 360}`, ["--r" as any]: `${(i % 5) * 70 - 140}deg` }} />)}</div>;

/* ----------------------------------------------------------------------------------------------- hub */

function Card({ t, open, i }: { t: Tour; open: (id: number) => void; i: number }) {
  const { d, f } = useT();
  const left = useLeft(t.expires_at);
  const o = t.result?.outcome;
  const tag = t.status === "open" ? (t.can_play ? <span className="tn-tag warn">{d.you_play}</span> : <span className="tn-tag">{f(d.waiting_for, { name: t.opponent.name })}</span>)
    : t.status === "declined" ? <span className="tn-tag">{d.declined}</span> : t.status === "cancelled" ? <span className="tn-tag">{d.cancelled}</span>
    : o === "won" ? <span className="tn-tag ok">🏆 {d.won}</span> : o === "lost" ? <span className="tn-tag">{d.lost}</span> : o === "draw" ? <span className="tn-tag warn">{d.drawn}</span> : <span className="tn-tag">{d.res_no}</span>;
  const total = t.created_at ? new Date(t.expires_at).getTime() - new Date(t.created_at).getTime() : 0;
  const frac = t.status === "open" && total > 0 ? Math.max(0, Math.min(1, (new Date(t.expires_at).getTime() - Date.now()) / total)) : 0;
  return (
    <button type="button" className={`tn-row${t.can_play ? " hot" : ""}`} style={{ ["--i" as any]: i }} onClick={() => open(t.id)}>
      <span className="tn-pair"><Av p={t.me} /><i>⚔</i><Av p={t.opponent} /></span>
      <span className="tn-row-main"><b>{t.opponent.name}{t.opponent.class_name ? <small className="muted"> · {t.opponent.class_name}</small> : null}</b>
        <span className="muted small">{t.subject} · {t.question_count} {d.questions} · {t.seconds_per_question}{d.s}</span>
        {t.status === "open" && <span className="tn-time"><i style={{ width: `${frac * 100}%` }} /></span>}</span>
      <span className="tn-row-end">{tag}{t.status === "open" && <small className="muted">{left}</small>}</span>
    </button>
  );
}

type Found = Person & { stakes?: Stakes };

function Create({ prefill, done, close, onSent }: { prefill?: Found | null; done: (id: number) => void; close: () => void; onSent?: () => void }) {
  const { d, f } = useT();
  const [o, setO] = useState<any>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [step, setStep] = useState<0 | 1>(prefill ? 1 : 0), [who, setWho] = useState<Found | null>(prefill ?? null);
  const [q, setQ] = useState(""), [form, setForm] = useState<number | null>(null), [res, setRes] = useState<Found[] | null>(null), [searching, setSearching] = useState(false);
  const [sent, setSent] = useState<Tour | null>(null);
  const [c, setC] = useState<{ subject?: number; count: number; seconds: number; hours: number }>({ count: 10, seconds: 30, hours: 48 });
  const seq = useRef(0), box = useRef<HTMLInputElement>(null);
  useEffect(() => { api("/tournaments/options/").then((x: any) => { setO(x); setC((p) => ({ count: x.defaults.count, seconds: x.defaults.seconds, hours: x.defaults.hours, subject: p.subject ?? x.subjects[0]?.id })); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (step === 0) box.current?.focus(); }, [step, o]);
  useEffect(() => {   // search as she types, never a full list
    const text = q.trim();
    if (text.length < 2) { setRes(null); setSearching(false); return; }
    setSearching(true);
    const my = ++seq.current;
    const h = setTimeout(async () => {
      try { const r = await api<{ results: Found[] }>(`/tournaments/search/?q=${encodeURIComponent(text)}${form ? `&form=${form}` : ""}`); if (my === seq.current) { setRes(r.results); setSearching(false); } }
      catch { if (my === seq.current) { setRes([]); setSearching(false); } }
    }, 260);
    return () => clearTimeout(h);
  }, [q, form]);
  const pick = (p: Found) => { setWho(p); setStep(1); setErr(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  async function send() {
    if (!who) return;
    setErr(""); setBusy(true);
    try { const t = await api<Tour>("/tournaments/", { body: { subject_id: c.subject, opponent_id: who.id, count: c.count, seconds: c.seconds, hours: c.hours } }); setSent(t); onSent?.(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  if (sent) return (
    <div className="card tn-sent"><Confetti /><div className="tn-sent-ico" aria-hidden>⚔️</div><h2>{d.sent}</h2>
      <p className="muted">{f(d.sent_sub, { name: who!.name, h: c.hours })}</p>
      <div className="row" style={{ justifyContent: "center" }}><button className="btn primary" onClick={() => done(sent.id)}>{d.play_mine} →</button><button className="btn" onClick={close}>{d.later_btn}</button></div></div>
  );
  if (!o) return err ? <ErrorNote error={err} /> : <PageSkeleton rows={3} />;
  const chips = (list: number[], key: "count" | "seconds" | "hours", suffix = "") => (
    <div className="tn-chips">{list.map((n) => <button key={n} type="button" className="tn-chip" aria-pressed={c[key] === n} onClick={() => setC({ ...c, [key]: n })}>{n}{suffix}</button>)}</div>
  );
  const persons = (list: Found[]) => list.map((p, i) => (
    <button key={p.id} type="button" className="tn-person" style={{ ["--i" as any]: i }} onClick={() => pick(p)}>
      <Av p={p} big /><span className="tn-person-main"><b>{p.name}</b><span className="muted small">{p.class_name || (p.form ? f(d.form_n, { n: p.form }) : "")}</span></span><Stake s={p.stakes} />
    </button>));
  const st = who?.stakes;
  const why = !who ? "" : !st || st.gap === 0 ? d.why_even : st.gap > 0 ? f(d.why_up, { name: who.name, n: st.win_pct - 100 }) : f(d.why_down, { name: who.name, win: st.win_pct, n: st.penalty });
  return (
    <div className="tn-wiz">
      <div className="tn-steps" aria-label={`${step + 1}/2`}><span className={step === 0 ? "on" : "done"}>1 · {d.step1}</span><i /><span className={step === 1 ? "on" : ""}>2 · {d.step2}</span></div>
      {step === 0 ? (
        <div className="tn-slide" key="s0">
          <h2 style={{ margin: "0 0 .6rem" }}>⚔️ {d.cta}</h2>
          <div className="tn-search"><span aria-hidden>🔎</span>
            <input ref={box} className="tn-search-in" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={d.search_ph} aria-label={d.search_ph} autoComplete="off" enterKeyHint="search" />
            {searching && <i className="spinner" aria-hidden />}</div>
          <div className="tn-forms" role="group" aria-label={d.class_lbl}>
            <button type="button" className="tn-chip sm" aria-pressed={form === null} onClick={() => setForm(null)}>{d.any_class}</button>
            {o.forms.map((n: number) => <button key={n} type="button" className="tn-chip sm" aria-pressed={form === n} onClick={() => setForm(n)}>{f(d.form_n, { n })}</button>)}</div>
          {res === null ? (
            <>
              <p className="muted small">{d.search_hint}</p>
              {o.recent.length > 0 && <><h3 className="tn-h">{d.recent}</h3><div className="tn-people">{persons(o.recent)}</div></>}
            </>
          ) : res.length === 0 ? (searching ? null : <p className="tn-none">🤷 {d.no_results}</p>) : <div className="tn-people" aria-live="polite">{persons(res)}</div>}
          <div className="row" style={{ marginTop: ".8rem" }}><button className="btn" onClick={close}>{d.back}</button></div>
        </div>
      ) : who && (
        <div className="tn-slide" key="s1">
          <div className="tn-arena small">
            <div className="tn-side l"><span className="tn-av huge">🙂</span><b>{d.you}</b></div>
            <div className="tn-vsbadge">VS</div>
            <div className="tn-side r"><Av p={who} huge /><b>{who.name}</b><small>{who.class_name}</small></div>
          </div>
          <div className={`tn-why ${!st || st.gap === 0 ? "even" : st.gap > 0 ? "up" : "down"}`}><Stake s={st} /><p>{why}</p><small>{d.why_questions}</small></div>
          {!o.subjects.length ? <p className="muted">{d.no_subjects}</p> : (
            <div className="card tn-set">
              <div><b>{d.pick_subject}</b><div className="tn-chips">{o.subjects.map((s: any) => <button key={s.id} type="button" className="tn-chip" aria-pressed={c.subject === s.id} onClick={() => setC({ ...c, subject: s.id })}>{s.name}</button>)}</div></div>
              <div><b>{d.pick_count}</b>{chips(o.counts, "count")}</div>
              <div><b>{d.pick_secs}</b>{chips(o.seconds, "seconds")}</div>
              <div><b>{d.pick_hours}</b>{chips(o.hours, "hours", " " + d.hours_unit)}</div>
            </div>
          )}
          {err && <p className="no" role="alert">⚠ {err}</p>}
          <div className="row"><button className="btn primary big" disabled={busy || !c.subject} onClick={send}>{busy ? <i className="spinner" aria-hidden /> : <>⚔️ {d.declare}</>}</button></div>
          <div className="row" style={{ marginTop: ".5rem" }}><button className="btn" onClick={() => setStep(0)}>← {d.change}</button></div>
        </div>
      )}
    </div>
  );
}

export function Hub({ open, pre }: { open: (id: number) => void; pre?: Found | null }) {
  const { d } = useT();
  const { data, error, loading, reload } = useMine<any>("/tournaments/");
  const [creating, setCreating] = useState<boolean>(!!pre), [tab, setTab] = useState<"live" | "done">("live");
  useEffect(() => { const i = setInterval(reload, 45_000); return () => clearInterval(i); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (creating) return <Create prefill={pre} close={() => { setCreating(false); reload(); }} done={open} onSent={reload} />;
  if (loading && !data) return <PageSkeleton rows={4} />;
  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  const r = data.record, rate = r.played ? Math.round((r.won / r.played) * 100) : 0;
  const live: Tour[] = data.active, done: Tour[] = data.history;
  const shown = tab === "live" ? live : done;
  return (
    <>
      <div className="card hero tn-hero">
        <span className="tn-orb a" aria-hidden /><span className="tn-orb b" aria-hidden />
        <div className="tn-hero-top"><span className="tn-swords" aria-hidden>⚔️</span><div><h2 style={{ margin: 0 }}>{d.title}</h2><p style={{ margin: ".2rem 0 0", opacity: .9 }} className="small">{d.intro}</p></div></div>
        <div className="tn-rec"><div><b><Count to={r.won} /></b><span>{d.won}</span></div><div><b><Count to={r.drawn} /></b><span>{d.drawn}</span></div><div><b><Count to={r.lost} /></b><span>{d.lost}</span></div><div><b><Count to={rate} />%</b><span>{d.win_rate}</span></div></div>
        <button className="btn tn-cta" onClick={() => setCreating(true)}>⚔️ {d.cta}</button>
      </div>
      <InviteSection onChange={reload} />
      <div className="tn-seg" role="tablist">
        <button role="tab" aria-selected={tab === "live"} className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>{d.live}{live.length > 0 && <em>{live.length}</em>}</button>
        <button role="tab" aria-selected={tab === "done"} className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>{d.finished}{done.length > 0 && <em>{done.length}</em>}</button>
      </div>
      {shown.length ? <div className="tn-list" key={tab}>{shown.map((t, i) => <Card key={t.id} t={t} open={open} i={i} />)}</div> : (
        <div className="card tn-empty"><div className="tn-empty-ico" aria-hidden>🥊</div><h3>{d.empty_title}</h3><p className="muted">{d.empty_sub}</p><button className="btn primary" onClick={() => setCreating(true)}>⚔️ {d.cta}</button></div>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------------------------------- playing */

function Run({ id, first, tour, finish }: { id: number; first: Cur; tour: Tour; finish: (t: Tour) => void }) {
  const { d, f } = useT();
  const [cur, setCur] = useState<Cur>(first), [v, setV] = useState<any>(() => initialValue(first.question)), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const deadline = useRef(Date.now() + first.seconds_left * 1000), sending = useRef(false);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 200); return () => clearInterval(i); }, []);
  const submit = useCallback(async (auto: boolean) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setErr("");
    try {
      const r = await api<{ tournament: Tour; current: Cur | null }>(`/tournaments/${id}/answer/`, { body: { question_id: cur.question.id, response: hasAnswer(cur.question, v) ? v : null } });
      window.dispatchEvent(new Event("amani:notifications"));
      if (r.current) { setCur(r.current); setV(initialValue(r.current.question)); deadline.current = Date.now() + r.current.seconds_left * 1000; window.scrollTo({ top: 0 }); sending.current = false; }
      else finish(r.tournament);
    } catch (e: any) { setErr(e.message); sending.current = false; if (/over|closed|ended|imeisha/i.test(e.message)) finish(tour); }
    setBusy(false);
    void auto;
  }, [cur, v, id, finish, tour]);
  const left = deadline.current - Date.now();
  useEffect(() => { if (left <= 0 && !sending.current) submit(true); });  // time is up: send whatever she has chosen
  return (
    <div className="tn-play">
      <div className="tn-bar"><b>{tour.subject}</b><span className="muted small">{f(d.q_of, { x: cur.index, y: cur.total })}</span></div>
      <div className="tn-dots" aria-hidden>{Array.from({ length: cur.total }, (_, i) => <i key={i} className={i < cur.index ? "on" : ""} />)}</div>
      <QTimer leftMs={left} totalSeconds={cur.seconds_total} label={d.time} />
      <div className="card" key={cur.question.id}>
        <QuestionView q={cur.question} value={v} onChange={(x) => { setV(x); setErr(""); }} disabled={busy} />
        {err && <p className="no" role="alert">⚠ {err}</p>}
      </div>
      <button className="btn primary big" disabled={busy} onClick={() => (hasAnswer(cur.question, v) ? submit(false) : setErr(d.answer_first))}>{busy ? <><i className="spinner" aria-hidden /> {d.saving}</> : <>{d.lock} →</>}</button>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- result */

function Result({ t, again }: { t: Tour; again: () => void }) {
  const { d, f } = useT();
  const r = t.result!;
  const o = r.outcome, kind = o === "won" ? "won" : o === "lost" ? "lost" : o === "draw" ? "draw" : "no";
  const title = o === "won" ? d.res_won : o === "lost" ? f(d.res_lost, { name: t.opponent.name }) : o === "draw" ? d.res_draw : o === "none" ? d.res_none : d.res_no;
  const note = r.how === "time" ? d.by_time : r.how === "score" ? d.by_score : o === "no_contest" || o === "none" ? d.no_contest_note : "";
  const side = (p: Person, s: any, win: boolean, mine: boolean) => (
    <div className={`tn-score${win ? " win" : ""}`}><Av p={p} big /><b>{s ? `${s.correct}/${s.total}` : "–"}</b><small>{mine ? d.you : p.name}</small>
      <small>{s ? `${secs(s.time_ms)} ${d.s} ${d.total_time}` : ""}</small>{mine && s && (s.xp > 0 ? <span className="tn-xp">{f(d.xp_earned, { n: s.xp })}</span> : s.xp < 0 ? <span className="tn-xp neg">{f(d.lost_xp, { n: -s.xp })}</span> : <small>{d.no_xp}</small>)}
      {mine && s && (s.win_pct ?? 100) > 100 && o === "won" && <span className="tn-stake up">🔥 {f(d.bonus, { n: (s.win_pct as number) - 100 })}</span>}
      {mine && s && (s.win_pct ?? 100) < 100 && o === "won" && <span className="tn-stake down">{f(d.reduced, { n: s.win_pct as number })}</span>}
      {mine && s && (s.penalty ?? 0) > 0 && <span className="tn-stake down">⚠️ {f(d.penalty_lbl, { n: s.penalty as number })}</span>}</div>
  );
  return (
    <>
      <div className={`tn-banner ${kind}`}>{o === "won" && <Confetti />}<div className="tn-trophy" style={{ fontSize: "2.6rem" }} aria-hidden>{o === "won" ? "🏆" : o === "draw" ? "🤝" : o === "lost" ? "💪" : "⌛"}</div><h2>{title}</h2>{note && <p style={{ margin: 0 }}>{note}</p>}</div>
      {(r.me || r.opponent) && <div className="tn-scores">{side(t.me, r.me, o === "won", true)}{side(t.opponent, r.opponent, o === "lost", false)}</div>}
      {r.badges.length > 0 && <div className="card"><h3>🏅 {d.badges}</h3><div className="tn-badges">{r.badges.map((b, i) => <span key={i} className="tn-badge">🏅 {b.name} · {b.tier_label}</span>)}</div></div>}
      {r.questions && (
        <div className="card"><h3>{d.review}</h3>
          <div className="tn-q head"><span /><span className="mk" title={d.you}>{d.you}</span><span className="mk" title={t.opponent.name}>{t.opponent.name.split(" ")[0]}</span></div>
          {r.questions.map((q, i) => (
            <div key={i} className="tn-q"><span className="small">{i + 1}. {q.prompt.replace(/<[^>]+>/g, "").slice(0, 90)}</span>
              <span className={`mk ${q.me >= 0.9999 ? "ok" : "no"}`} aria-label={d.you}>{q.me >= 0.9999 ? "✓" : q.me > 0 ? "½" : "✗"} <small>{secs(q.me_ms)}</small></span>
              <span className={`mk ${q.opponent >= 0.9999 ? "ok" : "no"}`} aria-label={t.opponent.name}>{q.opponent >= 0.9999 ? "✓" : q.opponent > 0 ? "½" : "✗"} <small>{secs(q.opponent_ms)}</small></span></div>
          ))}</div>
      )}
      <div className="row"><button className="btn primary" onClick={again}>⚔️ {d.rematch}</button></div>
    </>
  );
}

/* ----------------------------------------------------------------------------------------------- one tournament */

export function Detail({ id, back, rematch }: { id: number; back: () => void; rematch: (opponent: Person) => void }) {
  const { d, f } = useT();
  const [t, setT] = useState<Tour | null>(null), [err, setErr] = useState(""), [run, setRun] = useState<Cur | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setT(await api<Tour>(`/tournaments/${id}/`)); setErr(""); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!t || t.status !== "open" || run) return; const i = setInterval(load, 30_000); return () => clearInterval(i); }, [t?.status, run, load]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = useLeft(t?.expires_at ?? new Date().toISOString());
  async function start() {
    setBusy(true); setErr("");
    try { const r = await api<{ tournament: Tour; current: Cur | null }>(`/tournaments/${id}/play/`, { body: {} }); setT(r.tournament); setRun(r.current); if (!r.current) load(); } catch (e: any) { setErr(e.message); load(); }
    setBusy(false);
  }
  async function act(path: string) { setBusy(true); try { await api(`/tournaments/${id}/${path}/`, { body: {} }); await load(); } catch (e: any) { setErr(e.message); } setBusy(false); }
  if (!t) return err ? <><ErrorNote error={err} retry={load} /><button className="btn" onClick={back}>{d.back}</button></> : <PageSkeleton rows={4} />;
  if (run) return <Run id={id} first={run} tour={t} finish={(x) => { setRun(null); setT(x); window.dispatchEvent(new Event("amani:daily")); }} />;
  const when = new Date(t.expires_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <button className="btn" onClick={back}>← {d.back}</button>
      <div className="tn-arena" style={{ marginTop: ".8rem" }}>
        <div className="tn-side l"><Av p={t.me} huge /><b>{d.you}</b></div>
        <div className="tn-vsbadge">VS</div>
        <div className="tn-side r"><Av p={t.opponent} huge /><b>{t.opponent.name}</b><small>{t.opponent.class_name}</small></div>
        <div className="tn-arena-foot"><b>{t.subject}</b><span>{t.question_count} {d.questions} · {t.seconds_per_question}{d.s}</span>
          {t.status === "open" && <span>{d.expires.replace("{when}", when)} · {left}</span>}
          {t.status === "open" && <Stake s={t.stakes} />}</div>
      </div>
      {err && <p className="no" role="alert">⚠ {err}</p>}
      {t.status !== "open" ? (t.result ? <Result t={t} again={() => rematch({ ...t.opponent, stakes: t.stakes })} /> : <p className="muted">{t.status === "declined" ? d.declined : d.cancelled}</p>) : t.can_play ? (
        <div className="card">
          <h3>{d.ready}</h3>
          <ul className="tn-rules"><li>{f(d.r1, { n: t.question_count })}</li><li>{f(d.r2, { s: t.seconds_per_question })}</li><li>{d.r3}</li><li>{d.r4}</li><li>{f(d.r5, { when })}</li></ul>
          <div className="row">
            <button className="btn primary big" disabled={busy} onClick={start}>{busy ? <i className="spinner" aria-hidden /> : <>{t.me.status === "playing" ? d.continue : d.start} →</>}</button>
            {t.can_decline && <button className="btn danger" disabled={busy} onClick={() => act("decline")}>{d.decline}</button>}
          </div>
        </div>
      ) : (
        <div className="card tn-card"><h3>✅ {d.you_done}</h3><p className="muted">{f(d.waiting_for, { name: t.opponent.name })}. {t.opponent.status === "playing" ? f(d.theyre_playing, { name: t.opponent.name }) : ""}</p>
          <div className="row"><button className="btn" onClick={load}>{d.refresh}</button>{t.can_cancel && <button className="btn danger" disabled={busy} onClick={() => act("cancel")}>{d.cancel}</button>}</div></div>
      )}
    </>
  );
}
