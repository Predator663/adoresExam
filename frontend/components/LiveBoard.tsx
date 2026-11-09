"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import AntiCheat from "@/components/AntiCheat";
import Icon from "@/components/Icon";
import { Modal } from "@/components/ui";
import { api } from "@/lib/api";

/* Live monitor. One request for the whole school, polled every 6 s while the tab is visible.
   Phone first: every text box can shrink and wrap (min-width:0, overflow-wrap:anywhere), parents' numbers sit in their own panel, tabs and
   filters scroll or fold instead of overflowing. Rows render only for the exam that is open, 40 at a time.
   Motion: transform / opacity / stroke-dashoffset / grid-rows only. Everything stops for "reduce motion" (see the .lm rules in globals.css). */

type Parent = { id: number; name: string; phone: string; relationship?: string };
type Stu = {
  id: number; name: string; class: string; index: string; parents?: Parent[];
  left_screen?: number; answered?: number; started_at?: string | null; submitted_at?: string | null;
  seconds_left?: number; online?: boolean; auto_submitted?: boolean; completion?: "full" | "partial"; attempt_no?: number;
  attempt_id?: number; leaves_used?: number; locked?: boolean; lock_reason?: string;
  ended_by_admin?: boolean; end_reason?: string;
};
type ExamRow = {
  exam_id: number; title: string; subject: string; status: string; classes: string[];
  start_at: string; end_at: string; duration_minutes: number; eligible: number; in_progress: number;
  submitted: number; not_started: number; total_questions: number; full?: number; partial?: number;
  in_progress_students?: Stu[]; submitted_students?: Stu[]; not_started_students?: Stu[];
  connection_problems?: { id: number; name: string }[]; proximity_alerts?: number;
  leave_lock?: { enabled: boolean; limit: number };
};
type Board = { server_time: string; exams: ExamRow[]; totals: { live_exams: number; writing: number; submitted: number } };
type Kind = "w" | "s" | "n";

const POLL_MS = 6000;

/* one shared 1-second clock; only the tiny cells that show time subscribe to it */
const subs = new Set<() => void>();
let tickId: ReturnType<typeof setInterval> | null = null;
let nowSec = Math.floor(Date.now() / 1000);
function subscribe(fn: () => void) {
  subs.add(fn);
  if (!tickId) tickId = setInterval(() => { nowSec = Math.floor(Date.now() / 1000); subs.forEach((f) => f()); }, 1000);
  return () => { subs.delete(fn); if (!subs.size && tickId) { clearInterval(tickId); tickId = null; } };
}
const useNowSec = () => useSyncExternalStore(subscribe, () => nowSec, () => nowSec);

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
const hhmmss = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
const reduced = () => typeof document !== "undefined" && (document.documentElement.classList.contains("reduce-motion") || document.body.classList.contains("reduce-motion")
  || (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches));

/** A number that counts up or down to its new value instead of jumping. */
function CountUp({ value }: { value?: number }) {
  const [shown, setShown] = useState(value ?? 0);
  const cur = useRef(value ?? 0);
  useEffect(() => {
    if (value === undefined) return;
    if (reduced() || value === cur.current) { cur.current = value; setShown(value); return; }
    const from = cur.current, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3);
      cur.current = Math.round(from + (value - from) * e); setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{value === undefined ? "–" : shown}</>;
}

/** Height animates from 0 to its content (grid rows 0fr to 1fr); the content is only built while it is open or closing. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(t);
  }, [open]);
  return <div className={`lm-collapse ${open ? "open" : ""}`}><div className="lm-collapse-in">{mounted && children}</div></div>;
}

/* trim-path ring: stroke-dashoffset draws the arc */
function Ring({ pct, size = 54, tone = "g", urgent, children }: { pct: number; size?: number; tone?: "g" | "b" | "r" | "a"; urgent?: boolean; children?: React.ReactNode }) {
  const r = (size - 8) / 2, p = Math.max(0, Math.min(1, pct));
  return (
    <span className={`lb-ring t-${tone} ${urgent ? "urgent" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="lb-ring-bg" cx={size / 2} cy={size / 2} r={r} />
        <circle className="lb-ring-fg" cx={size / 2} cy={size / 2} r={r} pathLength={1} strokeDasharray={1} style={{ strokeDashoffset: 1 - p }} />
      </svg>
      <span className="lb-ring-txt">{children}</span>
    </span>
  );
}

const Countdown = memo(function Countdown({ base, at, total }: { base: number; at: number; total: number }) {
  const n = useNowSec();
  const left = Math.max(0, base - (n - at));
  return <Ring pct={total ? left / total : 0} size={48} tone={left < 300 ? "r" : "g"} urgent={left < 300 && left > 0}><b>{mmss(left)}</b></Ring>;
});

function StartsIn({ startIso, offset, onDue }: { startIso: string; offset: number; onDue: () => void }) {
  const n = useNowSec();
  const left = Math.floor(Date.parse(startIso) / 1000) - (n + offset);
  useEffect(() => { if (left <= 0) { const t = setTimeout(onDue, 800); return () => clearTimeout(t); } }, [left <= 0, n]); // eslint-disable-line
  return <span className="lb-soon">{left > 0 ? `Starts in ${left >= 3600 ? Math.floor(left / 3600) + "h " : ""}${mmss(left % 3600)}` : "Starting…"}</span>;
}

/** "Updated 4 s ago", counting up by itself. */
function Ago({ at, bad }: { at: number; bad: boolean }) {
  const n = useNowSec();
  const s = Math.max(0, n - at);
  return <small className={bad ? "lm-bad" : ""}>{bad ? "Trying again…" : s < 3 ? "Updated just now" : `Updated ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} ago`}</small>;
}

/** Parent numbers arrive masked. "Show number" asks the server for this one number and the reveal is audited. */
function ParentLine({ g }: { g: Parent }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function reveal() {
    setBusy(true);
    try { const r = (await api(`/proctoring/guardians/${g.id}/reveal-phone/`, { body: {} })) as { phone: string }; setFull(r.phone); } catch { /* not allowed or offline */ }
    setBusy(false);
  }
  return (
    <li className="lm-parent">
      <span className="lm-p-name">{g.relationship || "Parent"}: <b>{g.name}</b></span>
      <span className="lm-p-phone">{full || g.phone}</span>
      {full
        ? <a className="btn small primary" href={`tel:${full}`}><Icon n="phone" size={14} /> Call</a>
        : <button className="btn small" disabled={busy} onClick={reveal}>{busy ? "…" : "Show number"}</button>}
    </li>
  );
}

const Row = memo(function Row({ s, i, kind, total, at, dur, admin, leave, onLock, onEnd }: {
  s: Stu; i: number; kind: Kind; total: number; at: number; dur: number; admin: boolean; leave?: { enabled: boolean; limit: number };
  onLock?: (s: Stu, lock: boolean) => void; onEnd?: (s: Stu) => void;
}) {
  const [parentsOpen, setParentsOpen] = useState(false);
  const [flash, setFlash] = useState<"" | "up" | "warn">("");
  const prev = useRef({ a: s.answered ?? 0, o: s.online, l: s.left_screen ?? 0 });
  // A short glow when something just happened: she answered another question (green), went offline or left the screen (red).
  useEffect(() => {
    const p = prev.current;
    const f = (s.left_screen ?? 0) > p.l || (p.o && s.online === false) ? "warn" : (s.answered ?? 0) > p.a ? "up" : "";
    prev.current = { a: s.answered ?? 0, o: s.online, l: s.left_screen ?? 0 };
    if (!f) return;
    setFlash(f);
    const t = setTimeout(() => setFlash(""), 1400);
    return () => clearTimeout(t);
  }, [s.answered, s.online, s.left_screen]);

  const pct = total ? (s.answered ?? 0) / total : 0;
  const used = s.leaves_used ?? 0;
  const state = kind === "w" ? (s.online ? "on" : "off") : kind === "s" ? "done" : "idle";
  const why = s.lock_reason === "leaves" ? "Locked: left the screen too often" : s.lock_reason === "manual" ? "Locked by an administrator" : "Locked";
  const parents = s.parents ?? [];
  const canAct = kind === "w" && admin && !!s.attempt_id;
  return (
    <li className={`lm-row s-${state} ${flash ? `flash-${flash}` : ""}`} style={{ ["--i" as any]: Math.min(i, 12) }}>
      <span className="lm-av" aria-hidden="true"><b>{initials(s.name)}</b><i /></span>
      <div className="lm-who">
        <strong className="lm-name">{s.name}</strong>
        <span className="lm-meta">{s.class} · #{s.index}</span>
        <span className="lm-flags">
          {kind === "w" && (s.online ? <em className="lm-chip ok">Writing</em> : <em className="lm-chip bad">No signal</em>)}
          {kind === "s" && <em className={`lm-chip ${s.completion === "full" ? "ok" : "warn"}`}>{s.completion === "full" ? "Completed" : "Partial"}</em>}
          {kind === "n" && <em className="lm-chip">{dur ? "Has not written" : "No exam"}</em>}
          {(s.left_screen ?? 0) > 0 && <em className="lm-chip warn">Left screen ×{s.left_screen}{kind === "w" && leave?.enabled ? ` (${used}/${leave.limit})` : ""}</em>}
          {kind === "w" && s.locked && <em className="lm-chip bad">🔒 {why}</em>}
          {s.auto_submitted && <em className="lm-chip">Time ran out</em>}
          {s.ended_by_admin && <em className="lm-chip warn">Ended by an administrator</em>}
        </span>
      </div>
      <div className="lm-side">
        {kind === "w" && <Countdown base={s.seconds_left ?? 0} at={at} total={dur * 60} />}
        {kind === "s" && <Ring pct={pct} size={46} tone={s.completion === "full" ? "b" : "a"}><b>{Math.round(pct * 100)}%</b></Ring>}
      </div>
      {kind !== "n" && (
        <div className="lm-prog">
          <div className="lb-bar"><i style={{ transform: `scaleX(${pct})` }} /></div>
          <small>{s.answered ?? 0}/{total} answered · started {hhmm(s.started_at)}{kind === "s" && <> · submitted <b>{hhmmss(s.submitted_at)}</b></>}</small>
          {s.ended_by_admin && s.end_reason && <small className="lm-reason">Reason: {s.end_reason}</small>}
        </div>
      )}
      {admin && (canAct || parents.length > 0 || kind === "n") && (
        <div className="lm-actions">
          {canAct && onLock && <button className={`btn small ${s.locked ? "primary" : ""}`} onClick={() => onLock(s, !s.locked)}><Icon n={s.locked ? "unlock" : "lock"} size={14} /> {s.locked ? "Unlock" : "Lock"}</button>}
          {canAct && onEnd && <button className="btn small danger" onClick={() => onEnd(s)}>End exam</button>}
          {parents.length > 0
            ? <button className="btn small" aria-expanded={parentsOpen} onClick={() => setParentsOpen((o) => !o)}><Icon n="phone" size={14} /> Parents ({parents.length}) <span className={`lm-caret ${parentsOpen ? "up" : ""}`} aria-hidden>▾</span></button>
            : <small className="lm-nophone">No parent number on file</small>}
        </div>
      )}
      {parents.length > 0 && <Collapse open={parentsOpen}><ul className="lm-parents">{parents.slice(0, 3).map((g) => <ParentLine key={g.id} g={g} />)}</ul></Collapse>}
    </li>
  );
});

function StackBar({ a, b, c }: { a: number; b: number; c: number }) {
  const t = a + b + c || 1;
  return (
    <div className="lm-stack" role="img" aria-label={`${a} writing, ${b} submitted, ${c} not started`}>
      <i className="w" style={{ width: `${(a / t) * 100}%` }} /><i className="s" style={{ width: `${(b / t) * 100}%` }} /><i className="n" style={{ width: `${(c / t) * 100}%` }} />
    </div>
  );
}

function ExamCard({ e, i, open, onToggle, admin, at, q, cls, offset, onDue, onChanged }: {
  e: ExamRow; i: number; open: boolean; onToggle: () => void; admin: boolean; at: number; q: string; cls: string; offset: number; onDue: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<"w" | "f" | "p" | "n">("w");
  const [lockErr, setLockErr] = useState("");
  const [ending, setEnding] = useState<Stu | null>(null), [mark, setMark] = useState("submitted"), [why, setWhy] = useState(""), [endErr, setEndErr] = useState(""), [endBusy, setEndBusy] = useState(false);
  // End ONE student's running attempt (works after the exam has closed too). Her answers so far are marked, and the exam can publish for everybody.
  const endAttempt = async () => {
    if (!ending) return;
    setEndBusy(true); setEndErr("");
    try { await api(`/exams/${e.exam_id}/end-attempt/`, { body: { student_id: ending.id, mark, reason: why.trim() } }); setEnding(null); setWhy(""); setMark("submitted"); onChanged(); }
    catch (err: any) { setEndErr(err?.message || "Could not end her exam."); }
    finally { setEndBusy(false); }
  };
  // Manual lock / unlock of one student. An unlock also gives her a fresh allowance of exits.
  const setLock = useCallback(async (s: Stu, lock: boolean) => {
    if (!s.attempt_id) return;
    if (lock && !window.confirm(`Lock ${s.name}'s exam now? Her timer keeps running until you unlock her.`)) return;
    try { await api(`/proctoring/attempts/${s.attempt_id}/${lock ? "lock" : "unlock"}/`, { body: {} }); setLockErr(""); onChanged(); }
    catch (err: any) { setLockErr(err?.message || "Could not change the lock."); }
  }, [onChanged]);
  const [limit, setLimit] = useState(40);
  useEffect(() => setLimit(40), [tab, q, cls, open]);
  const live = e.status === "live", soon = e.status === "scheduled";
  const list = useMemo(() => {
    const sub = e.submitted_students ?? [];
    const src = (tab === "w" ? e.in_progress_students : tab === "f" ? sub.filter((x) => x.completion === "full")
      : tab === "p" ? sub.filter((x) => x.completion !== "full") : e.not_started_students) ?? [];
    const t = q.trim().toLowerCase();
    return src.filter((s) => (!cls || s.class === cls) && (!t || s.name.toLowerCase().includes(t) || String(s.index).toLowerCase().includes(t)));
  }, [e, tab, q, cls]);
  const done = e.eligible ? (e.submitted / e.eligible) : 0;
  const tabs = [["w", "Writing", e.in_progress], ["f", "Completed", e.full ?? 0], ["p", "Partial", e.partial ?? 0], ["n", live ? "Not started" : "Did not sit", e.not_started]] as const;
  return (
    <section className={`lm-card ${live ? "is-live" : soon ? "is-soon" : "is-done"} ${open ? "is-open" : ""}`} style={{ ["--i" as any]: Math.min(i, 8) }}>
      <button className="lm-head" onClick={onToggle} aria-expanded={open}>
        <Ring pct={done} size={56} tone={live ? "g" : "b"}><b>{Math.round(done * 100)}%</b></Ring>
        <span className="lm-title">
          <strong>{e.title}</strong>
          <span className="lm-chips">
            <i><Icon n="book" size={12} />{e.subject}</i>{e.classes.length > 0 && <i><Icon n="users" size={12} />{e.classes.join(", ")}</i>}
            <i><Icon n="clock" size={12} />{hhmm(e.start_at)}–{hhmm(e.end_at)} · {e.duration_minutes} min</i><i><Icon n="pencil" size={12} />{e.total_questions} questions</i>
          </span>
        </span>
        <span className="lm-state">
          {soon ? <StartsIn startIso={e.start_at} offset={offset} onDue={onDue} /> : <span className={live ? "lb-live" : "lb-closed"}>{live ? "LIVE" : e.status.toUpperCase()}</span>}
          <span className={`lm-chev ${open ? "up" : ""}`} aria-hidden><Icon n="chevron" size={16} /></span>
        </span>
        <span className="lm-counts">
          <StackBar a={e.in_progress} b={e.submitted} c={e.not_started} />
          <span className="lm-stats">
            <span className="lm-stat w"><b><CountUp value={e.in_progress} /></b><em><i />writing</em></span>
            <span className="lm-stat s"><b><CountUp value={e.submitted} /></b><em><i />submitted</em></span>
            <span className="lm-stat n"><b><CountUp value={e.not_started} /></b><em><i />not started</em></span>
          </span>
        </span>
      </button>
      <Collapse open={open}>
        <div className="lm-body">
          {!!e.connection_problems?.length && <p className="lb-alert lm-alert">No signal for 90 s: {e.connection_problems.map((c) => c.name).join(", ")}</p>}
          {admin ? (
            <>
              <div className="lm-tabs" role="tablist">
                {tabs.map(([k, label, n]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label} <b key={n} className="lm-bump">{n}</b></button>
                ))}
              </div>
              {live && e.leave_lock && <p className="muted small lm-note">{e.leave_lock.enabled ? `Auto-lock is on: a student who leaves the exam screen more than ${e.leave_lock.limit} time${e.leave_lock.limit === 1 ? "" : "s"} is locked until you unlock her.` : "Auto-lock for leaving the screen is off (Settings → School)."} You can also lock or unlock any student below.</p>}
              {lockErr && <p className="lb-alert lm-alert" role="alert">{lockErr}</p>}
              {list.length === 0 ? <p className="lm-empty-in">Nobody here{q || cls ? " for this filter" : " yet"}.</p> : (
                <ul className="lm-list" key={tab}>
                  {list.slice(0, limit).map((s, idx) => <Row key={s.id} s={s} i={idx} kind={tab === "w" ? "w" : tab === "n" ? "n" : "s"} total={e.total_questions} at={at} dur={e.duration_minutes} admin={admin} leave={e.leave_lock} onLock={setLock} onEnd={(x) => { setEndErr(""); setEnding(x); }} />)}
                </ul>
              )}
              {list.length > limit && <button className="lb-more" onClick={() => setLimit(limit + 40)}>Show {Math.min(40, list.length - limit)} more</button>}
            </>
          ) : <p className="lm-empty-in">Teachers see the counts above. Student names are for administrators.</p>}
        </div>
      </Collapse>
      {ending && (
        <Modal label="End this student's exam" onClose={() => !endBusy && setEnding(null)}>
          <h3>End {ending.name}&apos;s exam</h3>
          <p className="muted small">Her answers so far are kept and marked now. She cannot go back into the exam. Once nobody else is still writing, the results of this exam are published for everyone, hers included.</p>
          <label className="field"><span>Mark her as</span>
            <select className="input" value={mark} onChange={(x) => setMark(x.target.value)}>
              <option value="submitted">Submitted</option><option value="time_over">Time over (submitted automatically)</option>
            </select></label>
          <label className="field"><span>Reason (required, kept in the audit log)</span>
            <textarea className="input" rows={3} maxLength={300} value={why} onChange={(x) => setWhy(x.target.value)} placeholder="For example: extra time was given by mistake" /></label>
          {endErr && <p className="lb-alert" role="alert">{endErr}</p>}
          <div className="row">
            <button className="btn" disabled={endBusy} onClick={() => setEnding(null)}>Cancel</button>
            <button className="btn danger" disabled={endBusy || !why.trim()} onClick={endAttempt}>{endBusy ? "Ending…" : "End her exam"}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

const Skeleton = () => (
  <div className="lm-skel" aria-hidden="true">{[0, 1, 2].map((k) => <div key={k} className="lm-card"><i className="s1" /><i className="s2" /><i className="s3" /></div>)}</div>
);

export default function LiveBoard({ admin: adminProp }: { admin?: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [show, setShow] = useState<"all" | "live" | "done">("all");
  const [days, setDays] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(Math.floor(Date.now() / 1000));
  const [offset, setOffset] = useState(0);
  const [toast, setToast] = useState("");
  const [tabView, setTabView] = useState<"exams" | "ac">("exams");
  const [spin, setSpin] = useState(0);
  const lastAlerts = useRef<number | null>(null);
  const liveIds = useRef<Set<number> | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    try {
      const b = (await api(`/exams/monitor-board/?days=${days}`)) as Board;
      setBoard(b); setErr(""); setFetchedAt(Math.floor(Date.now() / 1000));
      setOffset(Math.round(Date.parse(b.server_time) / 1000 - Date.now() / 1000));
      const now = new Set(b.exams.filter((x) => x.status === "live").map((x) => x.exam_id));
      const fresh = liveIds.current ? b.exams.find((x) => now.has(x.exam_id) && !liveIds.current!.has(x.exam_id)) : undefined;
      liveIds.current = now;
      const nAl = b.exams.reduce((n, x) => n + (x.proximity_alerts ?? 0), 0);  // open, not yet reviewed
      if (lastAlerts.current !== null && nAl > lastAlerts.current) {
        setToast("⚠ Two students are sitting close together. Open the Anti-cheat tab."); setTimeout(() => setToast(""), 12000);
      }
      lastAlerts.current = nAl;
      if (fresh) { setToast(`${fresh.title} has started`); setOpenId(fresh.exam_id); setTimeout(() => setToast(""), 8000); }
      else setOpenId((cur) => cur ?? b.exams.find((x) => x.status === "live")?.exam_id ?? null);
    } catch (e: any) { setErr(e?.message || "Could not reach the server."); }
    finally { busy.current = false; }
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);

  const classes = useMemo(() => {
    const s = new Set<string>();
    board?.exams.forEach((e) => e.classes.forEach((c) => s.add(c)));
    return [...s].sort();
  }, [board]);
  const admin = adminProp ?? (!board?.exams.length || !!board.exams[0].in_progress_students);
  const openAlerts = (board?.exams ?? []).reduce((n, x) => n + (x.proximity_alerts ?? 0), 0);
  const exams = (board?.exams ?? []).filter((e) => (show === "all" || (show === "live") === (e.status === "live")) && (!cls || e.classes.includes(cls)));
  const activeFilters = (cls ? 1 : 0) + (days !== 1 ? 1 : 0);
  const kpi: [string, number | undefined, string, string][] = [
    ["activity", board?.totals.live_exams, "exams live", "g"], ["pencil", board?.totals.writing, "writing now", "b"], ["check", board?.totals.submitted, "submitted", "a"],
  ];

  return (
    <div className="lb lm">
      <header className="lm-hero">
        <div className="lm-status">
          <span className={`lm-dot ${err ? "bad" : ""}`} aria-hidden="true" />
          <span className="lm-status-txt"><b>{err ? "Connection lost" : "Live monitor"}</b><Ago at={fetchedAt} bad={!!err} /></span>
          <button className="lm-refresh" onClick={() => { setSpin((n) => n + 1); load(); }} aria-label="Refresh now"><span key={spin} className="lm-spin"><Icon n="refresh" size={18} /></span></button>
        </div>
        <div key={fetchedAt} className={`lm-sweep ${err ? "off" : ""}`} aria-hidden="true" />
      </header>

      <div className="lm-kpis">
        {kpi.map(([ic, n, label, tone]) => (
          <div key={label} className={`lm-kpi t-${tone} ${n ? "on" : ""}`}>
            <span className="lm-kpi-ic" aria-hidden="true"><Icon n={ic} size={18} /></span>
            <b><CountUp value={n} /></b><small>{label}</small>
          </div>
        ))}
      </div>

      {admin && (
        <div className="lm-switch" role="tablist" aria-label="Monitor view" style={{ ["--n" as any]: 2, ["--i" as any]: tabView === "ac" ? 1 : 0 }}>
          <span className="lm-switch-ind" aria-hidden="true" />
          <button role="tab" aria-selected={tabView === "exams"} className={tabView === "exams" ? "on" : ""} onClick={() => setTabView("exams")}><Icon n="pencil" size={16} /> Exams</button>
          <button role="tab" aria-selected={tabView === "ac"} className={tabView === "ac" ? "on" : ""} onClick={() => setTabView("ac")}>
            <Icon n="radar" size={16} /> Anti-cheat{openAlerts > 0 && <b className="lb-badge lm-pulse">{openAlerts}</b>}
          </button>
        </div>
      )}
      {(!admin || tabView === "exams") && <div className="lm-filters">
        <label className="lm-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input placeholder="Search name or index no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
          {q && <button type="button" className="lm-clear" onClick={() => setQ("")} aria-label="Clear search">×</button>}
        </label>
        <div className="lm-seg" role="group" aria-label="Which exams">
          {([["all", "All"], ["live", "Live"], ["done", "Finished"]] as const).map(([k, label]) => <button key={k} className={show === k ? "on" : ""} aria-pressed={show === k} onClick={() => setShow(k)}>{label}</button>)}
        </div>
        <button className="lm-filterbtn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}><Icon n="sliders" size={16} /> Filters{activeFilters > 0 && <b className="lb-badge">{activeFilters}</b>}</button>
        <div className={`lm-adv ${filtersOpen ? "open" : ""}`}>
          <select className="input" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">
            <option value="">All classes</option>
            {classes.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input" value={days} onChange={(e) => { setBoard(null); setDays(Number(e.target.value)); }} aria-label="Period">
            <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={120}>This term (120 days)</option>
          </select>
        </div>
      </div>}

      {toast && <p className="lm-toast" role="status">▶ {toast}</p>}
      {err && <p className="lb-alert lm-alert" role="alert">{err} Retrying…</p>}
      {!board && !err && !(admin && tabView === "ac") && <Skeleton />}
      {board && exams.length === 0 && !(admin && tabView === "ac") && <div className="lm-empty"><Icon n="calendar" size={28} /><p>No exams in this selection. Pick a longer period or clear the filters to see older exams and who did or missed them.</p></div>}
      {admin && tabView === "ac" && <div className="lm-view" key="ac"><AntiCheat exams={(board?.exams ?? []).map((e) => ({ exam_id: e.exam_id, title: e.title, status: e.status, in_progress: e.in_progress }))} /></div>}
      <div className="lm-grid" style={admin && tabView === "ac" ? { display: "none" } : undefined}>
        {exams.map((e, i) => (
          <ExamCard key={e.exam_id} e={e} i={i} open={openId === e.exam_id} onToggle={() => setOpenId(openId === e.exam_id ? null : e.exam_id)}
            admin={admin} at={fetchedAt} q={q} cls={cls} offset={offset} onDue={load} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
