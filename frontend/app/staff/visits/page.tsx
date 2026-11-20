"use client";
import { useEffect, useMemo, useState } from "react";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api, downloadFile, friendly } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import { classLabel } from "@/lib/staff";
import { useSession } from "@/lib/session";
import "./visits.css";

type Summary = { visits: number; students: number; total_seconds: number; avg_seconds: number; screens: string[];
  top_screens: { screen: string; path: string; visits: number; students: number; avg_seconds: number }[];
  top_students: { user_id: number; student: string; username: string; visits: number; seconds: number }[];
  by_day: { day: string; visits: number }[] };

const dur = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
const EMPTY = { q: "", class: "", screen: "", device: "", installed: "", from: "", to: "", min_seconds: "", sort: "" };

/** Which screens students open, when and for how long (administrators only). The app sends it by itself; see Privacy policy section 1. */
export default function Visits() {
  const { user, lang } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [f, setF] = useState(EMPTY);
  const [d, setD] = useState(EMPTY);  // the filters after a short pause, so typing does not ask the server on every letter
  useEffect(() => { const t = setTimeout(() => setD(f), 350); return () => clearTimeout(t); }, [f]);
  const set = (k: keyof typeof EMPTY, v: string) => setF({ ...f, [k]: v });
  const log = usePaged<any>(admin ? "/page-visits/log/" : null, d, { size: 25 });
  const qs = useMemo(() => { const u = new URLSearchParams(); Object.entries(d).forEach(([k, v]) => v && u.set(k, v)); return u.toString(); }, [d]);
  const sum = useLoad<Summary | null>(() => (admin ? api<Summary>(`/page-visits/summary/?${qs}`) : Promise.resolve(null)), [admin, qs]);
  const classes = useLoad(() => (admin ? api<any[]>("/classes/") : Promise.resolve([] as any[])));
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const filtered = Object.values(f).some(Boolean);
  const s = sum.data;
  const maxDay = Math.max(1, ...(s?.by_day || []).map((x) => x.visits));
  const maxScreen = Math.max(1, ...(s?.top_screens || []).map((x) => x.visits));

  async function csv() {
    setBusy(true); setErr("");
    try { await downloadFile(`/page-visits/log/?file=csv${qs ? `&${qs}` : ""}`, `page-visits-${new Date().toISOString().slice(0, 10)}.csv`); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }

  return (
    <Shell bare title="Page visits">
      <StaffNav />
      {!admin ? <p>Only administrators can read the page visit log.</p> : (
        <>
          <p className="muted small pv-note">Every screen a student opens in the app, for how long it was showing, and on what kind of device. Nothing she typed is recorded. Entries are deleted after 90 days.</p>

          <div className="card pv-filters" role="search">
            <div className="grid2">
              <label className="field"><span>Student</span><input className="input" type="search" placeholder="Name or username" autoComplete="off" value={f.q} onChange={(e) => set("q", e.target.value)} /></label>
              <label className="field"><span>Class</span><select className="input" value={f.class} onChange={(e) => set("class", e.target.value)}><option value="">All classes</option>{(classes.data || []).map((c: any) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></label>
              <label className="field"><span>Screen</span><select className="input" value={f.screen} onChange={(e) => set("screen", e.target.value)}><option value="">All screens</option>{(s?.screens || []).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              <label className="field"><span>Device</span><select className="input" value={f.device} onChange={(e) => set("device", e.target.value)}><option value="">Any device</option><option value="mobile">Phone</option><option value="tablet">Tablet</option><option value="desktop">Computer</option></select></label>
              <label className="field"><span>Installed app</span><select className="input" value={f.installed} onChange={(e) => set("installed", e.target.value)}><option value="">Either</option><option value="1">Opened from home screen</option><option value="0">Opened in browser</option></select></label>
              <label className="field"><span>Stayed at least (seconds)</span><input className="input" type="number" inputMode="numeric" min={0} placeholder="e.g. 30" value={f.min_seconds} onChange={(e) => set("min_seconds", e.target.value.replace(/\D/g, ""))} /></label>
              <label className="field"><span>From</span><input className="input" type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></label>
              <label className="field"><span>To</span><input className="input" type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></label>
              <label className="field"><span>Sort by</span><select className="input" value={f.sort} onChange={(e) => set("sort", e.target.value)}><option value="">Newest first</option><option value="longest">Longest stay first</option></select></label>
            </div>
            <div className="pv-actions">
              {filtered && <button type="button" className="btn ghost" onClick={() => setF(EMPTY)}>Clear filters</button>}
              <button type="button" className="btn" onClick={csv} disabled={busy}>{busy ? "Preparing…" : "⬇ Download CSV"}</button>
            </div>
            {err && <p className="no" role="alert">⚠ {err}</p>}
          </div>

          {sum.error ? <ErrorNote error={sum.error} retry={sum.reload} /> : s && (
            <>
              <div className="pv-stats">
                <div className="card"><b>{s.visits.toLocaleString()}</b><span>screen visits</span></div>
                <div className="card"><b>{s.students.toLocaleString()}</b><span>students</span></div>
                <div className="card"><b>{dur(s.total_seconds)}</b><span>total time on screens</span></div>
                <div className="card"><b>{dur(s.avg_seconds)}</b><span>average stay</span></div>
              </div>
              <div className="pv-two">
                <div className="card"><h2>Most opened screens</h2>
                  {s.top_screens.length === 0 ? <p className="muted">Nothing yet.</p> : <ul className="pv-bars">{s.top_screens.map((x) => (
                    <li key={x.path}><div className="pv-row"><b>{x.screen}</b><span>{x.visits.toLocaleString()} · {x.students} student{x.students === 1 ? "" : "s"} · avg {dur(x.avg_seconds)}</span></div><i style={{ width: `${Math.max(3, (x.visits / maxScreen) * 100)}%` }} /></li>))}</ul>}
                </div>
                <div className="card"><h2>Most active students</h2>
                  {s.top_students.length === 0 ? <p className="muted">Nothing yet.</p> : <ol className="pv-people">{s.top_students.map((x) => (
                    <li key={x.user_id}><button type="button" className="link" onClick={() => setF({ ...f, q: x.username })} title="Show only this student"><b>{x.student}</b></button><span>{x.visits.toLocaleString()} visits · {dur(x.seconds)}</span></li>))}</ol>}
                </div>
              </div>
              {s.by_day.length > 1 && (
                <div className="card"><h2>Visits per day</h2>
                  <div className="pv-days" role="img" aria-label="Bar chart of screen visits per day">{s.by_day.map((x) => (
                    <div key={x.day} className="pv-day" title={`${x.day}: ${x.visits}`}><i style={{ height: `${Math.max(4, (x.visits / maxDay) * 100)}%` }} /><span>{x.day.slice(8)}</span></div>))}</div>
                </div>
              )}
            </>
          )}

          {log.error ? <ErrorNote error={log.error} retry={log.reload} /> : log.loading ? <Loading /> : (
            <div className="card"><p className="muted small">{log.count.toLocaleString()} visits</p>
              <div className="tbl-wrap paged" ref={log.top} aria-busy={log.busy || undefined}>
                <table><thead><tr><th>When (EAT)</th><th>Student</th><th>Class</th><th>Screen</th><th>Stayed</th><th>Device</th></tr></thead>
                  <tbody>{log.rows.map((r: any) => (
                    <tr key={r.id}><td>{eatDate(r.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }, lang)}</td>
                      <td><b>{r.student}</b><br /><span className="muted small">{r.username}</span></td>
                      <td>{r.class ? <span className="pill">{r.class}</span> : "—"}</td>
                      <td>{r.screen}<br /><span className="muted small pv-path">{r.path}</span></td>
                      <td>{dur(r.seconds)}</td>
                      <td>{r.device_type === "mobile" ? "Phone" : r.device_type === "tablet" ? "Tablet" : r.device_type === "desktop" ? "Computer" : "—"}{r.installed ? " · app" : ""}</td></tr>))}
                    {log.rows.length === 0 && <tr><td colSpan={6} className="muted">No visits match these filters.</td></tr>}</tbody></table>
              </div>
              <Pager {...log.pager} />
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
