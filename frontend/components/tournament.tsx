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
    title: "Tournaments", intro: "Challenge a classmate. You both answer the same questions, each with a timer, whenever you like before the deadline. Whoever scores more wins XP and badges.",
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
    title: "Mashindano", intro: "Mpe changamoto mwanafunzi mwenzako. Nyote mnajibu maswali yale yale, kila swali lina saa, wakati wowote mnaotaka kabla ya muda kuisha. Mwenye alama nyingi anapata XP na beji.",
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
type Dict = typeof TXT.en;
const useT = () => {
  const { lang } = useSession();
  const d: Dict = TXT[lang === "sw" ? "sw" : "en"];
  const f = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
  return { d, f };
};

type Person = { id: number; name: string; avatar: string; status?: string };
type Row = { prompt: string; me: number; opponent: number; me_ms: number; opponent_ms: number };
type Tour = {
  id: number; subject: string; status: string; question_count: number; seconds_per_question: number; expires_at: string; role: string; me: Person; opponent: Person;
  can_play: boolean; can_decline: boolean; can_cancel: boolean;
  result?: { outcome: string; how: string; me: { correct: number; total: number; time_ms: number; xp: number } | null; opponent: { correct: number; total: number; time_ms: number } | null; badges: { name: string; tier_label: string }[]; questions?: Row[] };
};
type Cur = { index: number; total: number; seconds_total: number; seconds_left: number; question: Question };

const Av = ({ p, big }: { p: Person; big?: boolean }) => <span className={`tn-av${big ? " big" : ""}`} aria-hidden>{AVATAR_EMOJI[p.avatar] || "🙂"}</span>;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}`;

function useLeft(iso: string) {
  const { d, f } = useT();
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return d.over;
  const m = Math.round(ms / 60000);
  return m < 90 ? f(d.left_m, { n: Math.max(1, m) }) : m < 60 * 36 ? f(d.left_h, { n: Math.round(m / 60) }) : f(d.left_d, { n: Math.round(m / 1440) });
}

/* ----------------------------------------------------------------------------------------------- hub */

function Card({ t, open }: { t: Tour; open: (id: number) => void }) {
  const { d, f } = useT();
  const left = useLeft(t.expires_at);
  const o = t.result?.outcome;
  const tag = t.status === "open" ? (t.can_play ? <span className="tn-tag warn">{d.you_play}</span> : <span className="tn-tag">{f(d.waiting_for, { name: t.opponent.name })}</span>)
    : t.status === "declined" ? <span className="tn-tag">{d.declined}</span> : t.status === "cancelled" ? <span className="tn-tag">{d.cancelled}</span>
    : o === "won" ? <span className="tn-tag ok">{d.won}</span> : o === "lost" ? <span className="tn-tag">{d.lost}</span> : o === "draw" ? <span className="tn-tag warn">{d.drawn}</span> : <span className="tn-tag">{d.res_no}</span>;
  return (
    <button type="button" className="card tn-card" style={{ textAlign: "left", cursor: "pointer", width: "100%" }} onClick={() => open(t.id)}>
      <span className="tn-vs"><Av p={t.me} /><i>{d.vs}</i><Av p={t.opponent} /><b>{t.opponent.name}</b></span>
      <span className="row"><b>{t.subject}</b><span className="muted small">{t.question_count} {d.questions} · {t.seconds_per_question}{d.s}</span>{tag}</span>
      {t.status === "open" && <span className="muted small">{left}</span>}
    </button>
  );
}

function Create({ prefill, done, close }: { prefill?: { opponent?: number; subject?: number }; done: (id: number) => void; close: () => void }) {
  const { d } = useT();
  const [o, setO] = useState<any>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [f, setF] = useState<{ subject?: number; opponent?: number; count: number; seconds: number; hours: number }>({ count: 10, seconds: 30, hours: 48, ...prefill });
  useEffect(() => { api("/tournaments/options/").then((x: any) => { setO(x); setF((p) => ({ ...p, count: x.defaults.count, seconds: x.defaults.seconds, hours: x.defaults.hours, subject: p.subject ?? x.subjects[0]?.id })); }).catch((e) => setErr(e.message)); }, []);
  async function send() {
    setErr(""); setBusy(true);
    try { const t = await api<Tour>("/tournaments/", { body: { subject_id: f.subject, opponent_id: f.opponent, count: f.count, seconds: f.seconds, hours: f.hours } }); done(t.id); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  if (!o) return err ? <ErrorNote error={err} /> : <PageSkeleton rows={3} />;
  const chips = (list: number[], key: "count" | "seconds" | "hours", suffix = "") => (
    <div className="tn-chips">{list.map((n) => <button key={n} type="button" className="tn-chip" aria-pressed={f[key] === n} onClick={() => setF({ ...f, [key]: n })}>{n}{suffix}</button>)}</div>
  );
  return (
    <div className="card tn-card">
      <h2>{d.challenge}</h2>
      {!o.classmates.length ? <p className="muted">{d.no_classmates}</p> : !o.subjects.length ? <p className="muted">{d.no_subjects}</p> : (
        <>
          <div><b>{d.pick_who}</b>
            <div className="tn-chips" role="radiogroup" aria-label={d.pick_who}>
              {o.classmates.map((c: Person) => <button key={c.id} type="button" role="radio" aria-checked={f.opponent === c.id} aria-pressed={f.opponent === c.id} className="tn-chip" onClick={() => setF({ ...f, opponent: c.id })}>{AVATAR_EMOJI[c.avatar] || "🙂"} {c.name}</button>)}
            </div></div>
          <div><b>{d.pick_subject}</b>
            <div className="tn-chips">{o.subjects.map((s: any) => <button key={s.id} type="button" className="tn-chip" aria-pressed={f.subject === s.id} onClick={() => setF({ ...f, subject: s.id })}>{s.name}</button>)}</div></div>
          <div><b>{d.pick_count}</b>{chips(o.counts.filter((n: number) => !o.subjects.find((s: any) => s.id === f.subject) || n <= o.subjects.find((s: any) => s.id === f.subject).questions, ), "count")}</div>
          <div><b>{d.pick_secs}</b>{chips(o.seconds, "seconds")}</div>
          <div><b>{d.pick_hours}</b>{chips(o.hours, "hours", " " + d.hours_unit)}</div>
        </>
      )}
      {err && <p className="no" role="alert">⚠ {err}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || !f.opponent || !f.subject} onClick={send}>{busy ? d.saving : d.declare}</button>
        <button className="btn" onClick={close}>{d.back}</button>
      </div>
    </div>
  );
}

export function Hub({ open }: { open: (id: number) => void }) {
  const { d } = useT();
  const { data, error, loading, reload } = useMine<any>("/tournaments/");
  const [creating, setCreating] = useState<null | { opponent?: number; subject?: number }>(null);
  useEffect(() => { const i = setInterval(reload, 45_000); return () => clearInterval(i); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (creating) return <Create prefill={creating} close={() => setCreating(null)} done={open} />;
  if (loading && !data) return <PageSkeleton rows={4} />;
  if (error && !data) return <ErrorNote error={error} retry={reload} />;
  const r = data.record, list = (title: string, rows: Tour[]) => rows.length > 0 && <section><h2>{title}</h2>{rows.map((t) => <Card key={t.id} t={t} open={open} />)}</section>;
  const empty = !data.invites.length && !data.active.length && !data.history.length;  // (invitations are shown by <InviteSection/> above)
  return (
    <>
      <div className="card hero tn-hero">
        <div><h2 style={{ margin: 0 }}>⚔️ {d.title}</h2><p className="muted" style={{ margin: ".3rem 0 0" }}>{d.intro}</p>
          <div className="tn-rec"><div><b>{r.won}</b><span>{d.won}</span></div><div><b>{r.drawn}</b><span>{d.drawn}</span></div><div><b>{r.lost}</b><span>{d.lost}</span></div></div></div>
        <button className="btn" onClick={() => setCreating({})}>{d.challenge}</button>
      </div>
      <InviteSection onChange={reload} />{list(d.active, data.active)}{list(d.history, data.history)}
      {empty && <p className="muted">{d.none}</p>}
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
      <small>{s ? `${secs(s.time_ms)} ${d.s} ${d.total_time}` : ""}</small>{mine && s && (s.xp > 0 ? <span className="tn-xp">{f(d.xp_earned, { n: s.xp })}</span> : <small>{d.no_xp}</small>)}</div>
  );
  return (
    <>
      <div className={`tn-banner ${kind}`}><div style={{ fontSize: "2.4rem" }} aria-hidden>{o === "won" ? "🏆" : o === "draw" ? "🤝" : o === "lost" ? "💪" : "⌛"}</div><h2>{title}</h2>{note && <p style={{ margin: 0 }}>{note}</p>}</div>
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

export function Detail({ id, back, rematch }: { id: number; back: () => void; rematch: (opponent: number) => void }) {
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
      <div className="card tn-card" style={{ marginTop: ".8rem" }}>
        <span className="tn-vs"><Av p={t.me} big /><i>{d.vs}</i><Av p={t.opponent} big /><b>{t.opponent.name}</b></span>
        <span className="row"><b>{t.subject}</b><span className="muted small">{t.question_count} {d.questions} · {t.seconds_per_question}{d.s}</span></span>
        {t.status === "open" && <span className="muted small">{d.expires.replace("{when}", when)} · {left}</span>}
      </div>
      {err && <p className="no" role="alert">⚠ {err}</p>}
      {t.status !== "open" ? (t.result ? <Result t={t} again={() => rematch(t.opponent.id)} /> : <p className="muted">{t.status === "declined" ? d.declined : d.cancelled}</p>) : t.can_play ? (
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
