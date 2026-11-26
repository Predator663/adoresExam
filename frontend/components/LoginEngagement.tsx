"use client";
import { useEffect, useState } from "react";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import "./login-engagement.css";

const TREND: Record<string, [string, string, string]> = { up: ["▲", "Using it more", "up"], down: ["▼", "Using it less", "down"], dropped: ["⚠", "Has stopped using it", "drop"], steady: ["●", "Steady", "flat"] };
const PARTS: [string, string][] = [["regularity", "Regularity"], ["time", "Time on screen"], ["practice", "Practice"], ["exams", "Exams"]];
const DEV: Record<string, string> = { mobile: "📱", tablet: "📲", desktop: "💻", unknown: "❔" };
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const Stat = ({ n, label }: { n: string | number; label: string }) => <div className="stat"><b>{n}</b>{label}</div>;

function ScoreBadge({ score, tier }: { score: number; tier: string }) {
  const k = tier === "Highly engaged" ? "hi" : tier === "Engaged" ? "ok" : tier === "Occasional" ? "mid" : tier === "Rarely" ? "lo" : "none";
  return <span className={`le-score ${k}`}><b>{tier === "Not seen" ? "–" : score}</b><small>{tier}</small></span>;
}
function Parts({ parts }: { parts: Record<string, number> }) {
  return <div className="le-parts" aria-label="Score parts">{PARTS.filter(([k]) => k in parts).map(([k, n]) => <span key={k} title={`${n} · ${parts[k]}%`}><i style={{ width: `${parts[k]}%` }} /></span>)}</div>;
}

/** One student's engagement in detail: the score with its four parts, what her exams looked like, and the devices she signs in on. */
export function StudentEngagement({ id, days }: { id: number; days: number }) {
  const d = useLoad(() => api<any>(`/analytics/logins/engagement/${id}/?days=${days}`), [id, days]);
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <ErrorNote error={d.error} retry={d.reload} />;
  const s = d.data, t = TREND[s.trend] || TREND.steady, b = s.behaviour;
  return (
    <>
      <div className="card"><h3 style={{ marginTop: 0 }}>Engagement</h3>
        <div className="le-hero"><ScoreBadge score={s.score} tier={s.tier} /><span className={`le-trend ${t[2]}`}>{t[0]} {t[1]}</span></div>
        <div className="le-bars">{PARTS.filter(([k]) => k in s.parts).map(([k, label]) => (
          <div key={k}><span>{label}</span><div className="bar" role="progressbar" aria-valuenow={s.parts[k]} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${s.parts[k]}%` }} /></div><b>{s.parts[k]}%</b></div>))}</div>
        <div className="grid3">
          <Stat n={s.active_days} label="Days on the app" /><Stat n={`${s.minutes_per_day} min`} label="On screen per active day" /><Stat n={s.screens} label="Different screens used" />
          <Stat n={s.practice} label="Practice quizzes finished" /><Stat n={`${s.exams_taken}/${s.exams_eligible}`} label="Exams sat / meant to sit" /><Stat n={s.minutes_total} label="Minutes in total" />
        </div>
        <p className="muted small">Regularity counts days with a login or a screen visit, so a student who stays signed in on her phone is not under-counted. Scores are a guide for a conversation, not a grade.</p>
      </div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Exam behaviour</h3>
        {s.notes.length === 0 ? <p className="muted">Nothing unusual to look at in this period.</p> : <ul className="le-notes">{s.notes.map((n: any, i: number) => <li key={i} className={n.level}>{n.level === "warning" ? "⚠ " : "• "}{n.text}</li>)}</ul>}
        <p className="muted small">These are patterns to look at, not proof of anything.</p>
        {s.attempts.length > 0 && (
          <div className="tbl-wrap"><table><thead><tr><th>Exam</th><th>Started</th><th>Score</th><th>Time used</th><th>Late start</th><th>Left screen</th><th>Skipped</th><th>Seconds per answer</th></tr></thead><tbody>
            {s.attempts.map((a: any) => <tr key={a.attempt_id}><td>{a.exam}{a.auto_submitted && <span className="muted small"> · time ran out</span>}{a.locked && <span className="no small"> · locked</span>}</td><td>{eatDate(a.started_at)}</td>
              <td>{a.percent == null ? "–" : `${a.percent}%`}</td><td>{pct(a.time_used)}</td><td>{a.late_start_min == null ? "–" : `${a.late_start_min} min`}</td>
              <td>{a.left_screen ? <b className={a.left_screen >= 3 ? "no" : ""}>{a.left_screen}</b> : 0}</td><td>{a.skipped}/{a.answers}</td><td>{a.sec_per_answer ?? "–"}</td></tr>)}
          </tbody></table></div>)}
        {b.attempts > 0 && <p className="muted small">{b.attempts} exam(s) in this period · {b.left_screen_total} exits from the exam screen · {b.timed_out} questions timed out.</p>}
      </div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Devices</h3>
        {s.device ? <p>{DEV[s.device.device_type] || "❔"} Last opened on <b>{s.device.device || s.device.device_type}</b> · {s.device.os} · {s.device.browser}{s.device.installed ? " · installed app" : ""} <span className="muted small">({eatDate(s.device.last_seen)})</span></p> : <p className="muted">No device seen yet.</p>}
        {s.devices_used.length > 0 && <div className="tbl-wrap"><table><thead><tr><th>Signed in on</th><th>System</th><th>Browser</th><th>Logins</th></tr></thead><tbody>
          {s.devices_used.map((u: any, i: number) => <tr key={i}><td>{DEV[u.device_type] || "❔"} {u.device_type}</td><td>{u.os}</td><td>{u.browser}</td><td>{u.logins}</td></tr>)}</tbody></table></div>}
      </div>
    </>
  );
}

/** Every student with an engagement score, sorted so the ones needing attention come first. */
export function EngagementTab({ days, cls, onOpen }: { days: number; cls: string; onOpen: (id: number) => void }) {
  const [q, setQ] = useState(""), [qq, setQq] = useState(""), [sort, setSort] = useState("attention"), [tier, setTier] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setQq(q.trim()); setPage(1); }, 300); return () => clearTimeout(h); }, [q]);
  const d = useLoad(() => {
    const p = new URLSearchParams({ days: String(days), page: String(page), page_size: "20", sort });
    if (cls) p.set("class", cls); if (tier) p.set("tier", tier); if (qq) p.set("q", qq);
    return api<any>(`/analytics/logins/engagement/?${p}`);
  }, [days, cls, qq, sort, tier, page]);
  const s = d.data?.summary;
  return (
    <>
      {s && <div className="grid3">
        <Stat n={s.average} label="Average engagement score" /><Stat n={s.dropped} label="Stopped using it recently" />
        {s.tiers.slice(0, 4).map((t: any) => <button key={t.label} type="button" className={`stat le-tier${tier === t.label ? " on" : ""}`} onClick={() => { setTier(tier === t.label ? "" : t.label); setPage(1); }} aria-pressed={tier === t.label}><b>{t.count}</b>{t.label}</button>)}
        <button type="button" className={`stat le-tier${tier === "Not seen" ? " on" : ""}`} onClick={() => { setTier(tier === "Not seen" ? "" : "Not seen"); setPage(1); }} aria-pressed={tier === "Not seen"}><b>{s.tiers[4].count}</b>Not seen</button>
      </div>}
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: ".6rem" }}>
          <input className="input grow" type="search" placeholder="Search name or index number" aria-label="Search students" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Order" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            <option value="attention">Needs attention first</option><option value="least">Lowest score first</option><option value="score">Highest score first</option><option value="name">Name</option></select>
        </div>
        {d.loading && !d.data ? <Loading /> : d.error || !d.data ? <ErrorNote error={d.error} retry={d.reload} /> : !d.data.results.length ? <p className="muted">No students match.</p> : (
          <>
            <div className="tbl-wrap" aria-busy={d.loading || undefined}><table>
              <thead><tr><th>Student</th><th>Engagement</th><th>Trend</th><th>Per active day</th><th>Practice</th><th>Exams</th><th>Device</th><th>To look at</th></tr></thead>
              <tbody>{d.data.results.map((r: any) => {
                const t = TREND[r.trend] || TREND.steady, warn = r.notes.filter((n: any) => n.level === "warning").length;
                return (
                  <tr key={r.id}>
                    <td><button className="btn" onClick={() => onOpen(r.id)}>{r.name}</button><br /><span className="muted small">{r.class} · {r.index}</span></td>
                    <td><ScoreBadge score={r.score} tier={r.tier} /><Parts parts={r.parts} /></td>
                    <td><span className={`le-trend ${t[2]}`} title={t[1]}>{t[0]}</span></td>
                    <td>{r.minutes_per_day} min<br /><span className="muted small">{r.active_days} days</span></td>
                    <td>{r.practice}</td><td>{r.exams_taken}/{r.exams_eligible}</td>
                    <td>{r.device ? <span title={`${r.device.os} · ${r.device.browser}`}>{DEV[r.device.device_type] || "❔"} <span className="small">{r.device.browser}</span></span> : <span className="muted">–</span>}</td>
                    <td>{r.notes.length ? <span className={warn ? "no" : "muted"}>{warn ? "⚠ " : ""}{r.notes.length} note{r.notes.length > 1 ? "s" : ""}</span> : <span className="muted">–</span>}</td>
                  </tr>);
              })}</tbody></table></div>
            {d.data.pages > 1 && <div className="row" style={{ justifyContent: "center", gap: ".6rem" }}>
              <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button><span className="muted">Page {d.data.page} of {d.data.pages}</span>
              <button className="btn" disabled={page >= d.data.pages} onClick={() => setPage(page + 1)}>Next →</button></div>}
          </>
        )}
      </div>
    </>
  );
}

function Shares({ title, rows, icon }: { title: string; rows: { label: string; count: number; share: number }[]; icon?: (l: string) => string }) {
  return (
    <div className="card"><h3 style={{ marginTop: 0 }}>{title}</h3>
      {rows.length === 0 ? <p className="muted">Nothing recorded yet.</p> : <div className="le-shares">{rows.map((r) => (
        <div key={r.label}><span>{icon ? icon(r.label) + " " : ""}{r.label}</span><div className="bar" aria-hidden><i style={{ width: `${r.share}%` }} /></div><b>{r.count} <small className="muted">· {r.share}%</small></b></div>))}</div>}
    </div>
  );
}

/** Which devices, systems and browsers students use. */
export function DevicesTab({ days, cls }: { days: number; cls: string }) {
  const d = useLoad(() => api<any>(`/analytics/logins/devices/?days=${days}${cls ? `&class=${cls}` : ""}`), [days, cls]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error || !d.data) return <ErrorNote error={d.error} retry={d.reload} />;
  const x = d.data, l = x.logins;
  return (
    <>
      <div className="grid3"><Stat n={`${x.seen}/${x.students}`} label="Students who opened the app" /><Stat n={x.installed} label="Using the installed app" /><Stat n={x.not_seen} label="Not seen this period" /></div>
      <p className="muted small">Based on the last device each student opened the app on during this period.</p>
      <div className="grid2">
        <Shares title="Kind of device" rows={x.type} icon={(k) => DEV[k.toLowerCase()] || "❔"} /><Shares title="System" rows={x.os} />
        <Shares title="Browser" rows={x.browser} /><Shares title="Phone or tablet model" rows={x.model} /><Shares title="Connection" rows={x.connection} />
      </div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Sign-in history</h3>
        <p className="muted small">The device used at each login. The school started recording this when this update was installed, so older logins are not included: {l.recorded} of {l.total} logins in this period have a device.</p>
        <div className="grid2"><Shares title="Logins by device" rows={l.type} icon={(k) => DEV[k.toLowerCase()] || "❔"} /><Shares title="Logins by system" rows={l.os} /><Shares title="Logins by browser" rows={l.browser} /></div>
      </div>
    </>
  );
}
