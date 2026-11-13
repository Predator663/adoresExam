"use client";
/* One simple picker for "when can students sit this exam": tap the day on a calendar, tap a start time, tap how long the
   window stays open. The end moves together with the start, so most exams are two or three taps. Values are the same
   "YYYY-MM-DDTHH:mm" East Africa Time strings the form already used. */
import { useEffect, useRef, useState } from "react";
import "./exam-window.css";

const pad = (n: number) => String(n).padStart(2, "0");
const ms = (s: string) => { if (!s || s.length < 16) return NaN; const [d, t] = s.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number); return Date.UTC(y, m - 1, dd, h, mi); };
const str = (n: number) => new Date(n).toISOString().slice(0, 16);
const dateOf = (s: string) => (s || "").slice(0, 10), timeOf = (s: string) => (s || "").slice(11, 16);
const nowEat = () => str(Date.now() + 3 * 36e5);   // "now" in East Africa Time, whatever the computer's own time zone is
const addDays = (d: string, n: number) => str(ms(`${d}T00:00`) + n * 864e5).slice(0, 10);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], DOW_LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const nice = (s: string) => { const t = ms(s); if (!isFinite(t)) return "—"; const d = new Date(t); return `${DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`; };
const hm12 = (t: string) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "am" : "pm"}`; };
const TIMES = ["07:00", "08:00", "09:00", "10:00", "11:00", "14:00", "15:00"];

export default function ExamWindowPicker({ start, end, duration, disabled, onChange }: { start: string; end: string; duration: number; disabled?: boolean; onChange: (p: { start: string; end: string }) => void }) {
  const today = nowEat().slice(0, 10), nowStr = nowEat();
  const sd = dateOf(start), ed = dateOf(end), st = timeOf(start), et = timeOf(end);
  const dur = Math.max(1, Number(duration) || 60);
  const gap = (ms(end) - ms(start)) / 6e4, defGap = dur + 30;
  const keepGap = isFinite(gap) && gap > 0 ? gap : defGap;
  const [multi, setMulti] = useState(false), [pick, setPick] = useState<"start" | "end">("start"), [dir, setDir] = useState(1);
  const seed = sd || today;
  const [view, setView] = useState({ y: +seed.slice(0, 4), m: +seed.slice(5, 7) - 1 });
  const touched = useRef(false);
  useEffect(() => {  // an exam that was loaded after this picker appeared: show its month, and open multi-day mode if it spans days
    if (touched.current || !sd) return;
    setView({ y: +sd.slice(0, 4), m: +sd.slice(5, 7) - 1 });
    if (ed && ed !== sd) setMulti(true);
  }, [sd, ed]);
  const set = (s: string, e: string) => { touched.current = true; onChange({ start: s, end: e }); };

  const pickDay = (d: string) => {
    if (disabled) return;
    const t = st || "09:00";
    if (!multi || pick === "start" || d < sd) {
      const s = `${d}T${t}`;
      set(s, str(ms(s) + keepGap * 6e4));
      if (multi) setPick("end");
    } else { set(start, `${d}T${et || "10:30"}`); setPick("start"); }
  };
  const jump = (d: string) => { pickDay(d); setDir(d >= `${view.y}-${pad(view.m + 1)}-01` ? 1 : -1); setView({ y: +d.slice(0, 4), m: +d.slice(5, 7) - 1 }); };
  const setStartTime = (t: string) => { if (!t || disabled) return; const s = `${sd || today}T${t}`; set(s, str(ms(s) + keepGap * 6e4)); };
  const setEndTime = (t: string) => { if (!t || disabled) return; set(start || `${today}T09:00`, `${ed || sd || today}T${t}`); };
  const setExtra = (extra: number) => { if (disabled) return; const s = start || `${sd || today}T09:00`; set(s, str(ms(s) + (dur + extra) * 6e4)); };
  const nav = (n: number) => { setDir(n); setView((v) => { const t = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; }); };

  const first = new Date(Date.UTC(view.y, view.m, 1)), lead = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${view.y}-${pad(view.m + 1)}-${pad(i + 1)}`)];
  const valid = isFinite(ms(start)) && isFinite(ms(end));
  const win = valid ? Math.round(gap) : 0;
  const problems: string[] = [];
  if (valid && ms(end) <= ms(start)) problems.push("The end must be after the start.");
  else if (valid && win < dur) problems.push(`The window (${win} min) is shorter than the exam (${dur} min), so students could not finish.`);
  if (valid && start < nowStr) problems.push("This start time has already passed.");
  const extra = valid ? win - dur : -1;
  const quick: [string, string][] = [["Today", today], ["Tomorrow", addDays(today, 1)], ["Next Monday", addDays(today, ((8 - new Date(ms(`${today}T00:00`)).getUTCDay()) % 7) || 7)], ["In a week", addDays(today, 7)]];

  return (
    <div className={`ewp ${disabled ? "off" : ""}`}>
      <div className="ewp-quick" role="group" aria-label="Quick dates">
        {quick.map(([n, d]) => <button key={n} type="button" disabled={disabled} className={`ewp-chip ${sd === d ? "on" : ""}`} onClick={() => jump(d)}>{n}</button>)}
        <label className="ewp-multi"><input type="checkbox" disabled={disabled} checked={multi} onChange={(e) => { setMulti(e.target.checked); setPick("start"); if (!e.target.checked && valid) set(start, `${sd}T${et}`); }} /> Several days</label>
      </div>

      <div className="ewp-cal">
        <div className="ewp-head">
          <button type="button" className="ewp-nav" aria-label="Previous month" onClick={() => nav(-1)}>‹</button>
          <b key={`${view.y}-${view.m}`} className={`ewp-title ${dir > 0 ? "r" : "l"}`} aria-live="polite">{MONTHS[view.m]} {view.y}</b>
          <button type="button" className="ewp-nav" aria-label="Next month" onClick={() => nav(1)}>›</button>
        </div>
        <div className="ewp-dow" aria-hidden>{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        <div key={`${view.y}-${view.m}`} className={`ewp-grid ${dir > 0 ? "r" : "l"}`} role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`}>
          {cells.map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const past = d < today, a = d === sd, b = d === ed && multi, mid = multi && sd && ed && d > sd && d < ed;
            return (
              <button key={d} type="button" disabled={disabled || past} aria-pressed={a || b} aria-label={`${nice(`${d}T00:00`)} ${view.y}`}
                className={`ewp-day ${d === today ? "today" : ""} ${a ? "start" : ""} ${b ? "end" : ""} ${mid ? "mid" : ""} ${a && multi && ed !== sd ? "band-r" : ""} ${b && ed !== sd ? "band-l" : ""}`}
                style={{ animationDelay: `${Math.min(i, 35) * 8}ms` }} onClick={() => pickDay(d)}><span>{+d.slice(8)}</span></button>
            );
          })}
        </div>
        {multi && <p className="ewp-hint" role="status">{pick === "end" ? "Now tap the last day." : "Tap the first day."}</p>}
      </div>

      <div className="ewp-times">
        <div className="ewp-block">
          <span className="ewp-label">Starts at</span>
          <div className="ewp-chips">{TIMES.map((t) => <button key={t} type="button" disabled={disabled} className={`ewp-chip ${st === t ? "on" : ""}`} onClick={() => setStartTime(t)}>{hm12(t)}</button>)}</div>
          <label className="ewp-time"><span className="sr-only">Start time</span><input className="input" type="time" step={300} disabled={disabled} value={st} onChange={(e) => setStartTime(e.target.value)} /></label>
        </div>
        <div className="ewp-block">
          <span className="ewp-label">Students can start until <small>(then each has {dur} min)</small></span>
          <div className="ewp-chips">
            {[[0, "Exactly the exam time"], [30, "+30 min"], [60, "+1 hour"], [120, "+2 hours"]].map(([x, n]) => <button key={x} type="button" disabled={disabled || !sd} className={`ewp-chip ${extra === x ? "on" : ""}`} onClick={() => setExtra(x as number)}>{n}</button>)}
          </div>
          <label className="ewp-time"><span className="sr-only">End time</span><input className="input" type="time" step={300} disabled={disabled} value={et} onChange={(e) => setEndTime(e.target.value)} /></label>
        </div>
      </div>

      <div key={`${start}|${end}`} className={`ewp-sum ${valid ? "" : "empty"} ${problems.length ? "bad" : ""}`} role="status">
        {valid ? (
          <>
            <div className="ewp-when"><span className="ewp-d">{nice(start)}</span><b>{hm12(st)}</b><i aria-hidden>→</i>{ed !== sd && <span className="ewp-d">{nice(end)}</span>}<b>{hm12(et)}</b></div>
            <div className="ewp-sub">Window open for {win >= 60 ? `${Math.floor(win / 60)} h${win % 60 ? ` ${win % 60} min` : ""}` : `${win} min`} · exam length {dur} min · East Africa Time</div>
            {problems.map((p) => <p key={p} className="ewp-warn">⚠ {p}</p>)}
          </>
        ) : <div className="ewp-sub">👆 Pick a day to begin. The start and end time are filled in for you, and you can change them.</div>}
      </div>
    </div>
  );
}
