"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { ErrorNote, useLoad } from "@/components/ui";
import { api, downloadFile, friendly } from "@/lib/api";
import { classLabel } from "@/lib/staff";
import { useSession } from "@/lib/session";
import "./visits.css";

type Summary = { visits: number; students: number; total_seconds: number; avg_seconds: number; screens: string[];
  top_screens: { screen: string; path: string; visits: number; students: number; avg_seconds: number }[];
  top_students: { user_id: number; student: string; username: string; visits: number; seconds: number }[];
  by_day: { day: string; visits: number }[] };

const dur = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
const EMPTY = { q: "", class: "", screen: "", device: "", installed: "", from: "", to: "", min_seconds: "", sort: "" };
const LABEL: Record<string, string> = { q: "Student", class: "Class", screen: "Screen", device: "Device", installed: "App", from: "From", to: "To", min_seconds: "Stayed ≥", sort: "Sort" };
const DEVICE: Record<string, string> = { mobile: "Phone", tablet: "Tablet", desktop: "Computer" };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase() || "?";
const reduced = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion"));

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A number that counts up to its value (instantly when the person asked for less motion). */
function Num({ v, fmt = (n: number) => n.toLocaleString() }: { v: number; fmt?: (n: number) => string }) {
  const [n, setN] = useState(reduced() ? v : 0), last = useRef(reduced() ? v : 0);
  useEffect(() => {
    if (reduced()) { setN(v); last.current = v; return; }
    let raf = 0, t0 = 0;
    const from = last.current;
    const run = (t: number) => {
      t0 = t0 || t;
      const p = Math.min(1, (t - t0) / 800), val = Math.round(from + (v - from) * (1 - Math.pow(1 - p, 3)));
      setN(val); last.current = val;
      if (p < 1) raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <>{fmt(n)}</>;
}

/** Which screens students open, when and for how long (administrators only). The app sends it by itself; see Privacy policy section 1. */
export default function Visits() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [f, setF] = useState(EMPTY);
  const [d, setD] = useState(EMPTY);  // the filters after a short pause, so typing does not ask the server on every letter
  const [more, setMore] = useState(false), [live, setLive] = useState(true), [now, setNow] = useState(() => Date.now()), [pick, setPick] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setD(f), 350); return () => clearTimeout(t); }, [f]);
  const set = (k: keyof typeof EMPTY, v: string) => setF((x) => ({ ...x, [k]: v }));
  const log = usePaged<any>(admin ? "/page-visits/log/" : null, d, { size: 25 });
  const qs = useMemo(() => { const u = new URLSearchParams(); Object.entries(d).forEach(([k, v]) => v && u.set(k, v)); return u.toString(); }, [d]);
  const sum = useLoad<Summary | null>(() => (admin ? api<Summary>(`/page-visits/summary/?${qs}`) : Promise.resolve(null)), [admin, qs]);
  const classes = useLoad(() => (admin ? api<any[]>("/classes/") : Promise.resolve([] as any[])));
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [stamp, setStamp] = useState(() => new Date());
  const s = sum.data;
  const active = (Object.keys(f) as (keyof typeof EMPTY)[]).filter((k) => f[k]);
  const advanced = active.filter((k) => k !== "q" && k !== "from" && k !== "to").length;
  const range = f.from === "" && f.to === "" ? "all" : f.to === "" && f.from === ymd(new Date()) ? "today" : f.to === "" && f.from === daysAgo(6) ? "7" : f.to === "" && f.from === daysAgo(29) ? "30" : "custom";

  // live: the clock for "x min ago" ticks, and the lists refresh quietly every 30 s while the tab is showing
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!live || !admin) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") { log.reload(); sum.reload(); setStamp(new Date()); } }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, admin, qs]);

  async function csv() {
    setBusy(true); setErr("");
    try { await downloadFile(`/page-visits/log/?file=csv${qs ? `&${qs}` : ""}`, `page-visits-${new Date().toISOString().slice(0, 10)}.csv`); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  const reload = () => { log.reload(); sum.reload(); setStamp(new Date()); };
  const shown = (k: string, v: string) => k === "class" ? classLabel((classes.data || []).find((c: any) => String(c.id) === v) || { name: v }) : k === "device" ? DEVICE[v] || v : k === "installed" ? (v === "1" ? "Home-screen app" : "Browser") : k === "sort" ? "Longest stay" : k === "min_seconds" ? `${v}s` : v;
  const maxDay = Math.max(1, ...(s?.by_day || []).map((x) => x.visits)), maxScreen = Math.max(1, ...(s?.top_screens || []).map((x) => x.visits));
  const maxSec = Math.max(1, ...log.rows.map((r: any) => r.seconds));
  const day = pick !== null && s?.by_day[pick] ? s.by_day[pick] : null;
  const first = !s && sum.loading;

  const row = (r: any, i: number) => (
    <div key={r.id} className="pv-item" style={{ ["--i" as any]: Math.min(i, 14) }}>
      <span className="pv-av" style={{ background: `hsl(${hue(r.username)} 55% 42%)` }} aria-hidden>{initials(r.student)}</span>
      <div className="pv-who"><b>{r.student}</b><span>{r.class || r.username}</span></div>
      <div className="pv-scr"><span className="pv-dot" style={{ background: `hsl(${hue(r.screen)} 65% 46%)` }} /><div><b>{r.screen}</b><small>{r.path}</small></div></div>
      <div className="pv-stay"><b>{dur(r.seconds)}</b><i><u style={{ width: `${Math.max(4, (r.seconds / maxSec) * 100)}%` }} /></i></div>
      <div className="pv-when" title={new Date(r.at).toLocaleString()}><b>{ago(r.at, now)}</b><small>{DEVICE[r.device_type] || "—"}{r.installed ? " · app" : ""}</small></div>
    </div>
  );

  return (
    <Shell bare title="Page visits">
      <StaffNav />
      {!admin ? <p>Only administrators can read the page visit log.</p> : (
        <div className="pv">
          <header className="pv-hero">
            <div className="pv-hero-t">
              <h1>Page visits</h1>
              <p>Every screen a student opens, how long it was showing and on what device. Nothing she types is recorded. Kept 90 days.</p>
            </div>
            <div className="pv-hero-a">
              <button type="button" className={`pv-live ${live ? "on" : ""}`} aria-pressed={live} onClick={() => setLive(!live)} title={live ? "Updating every 30 seconds. Tap to pause." : "Paused. Tap to resume."}>
                <i aria-hidden /><span>{live ? "Live" : "Paused"}</span><small>{stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
              </button>
              <button type="button" className="btn pv-ic" onClick={reload} aria-label="Refresh now"><span className={log.busy || sum.loading ? "spin" : ""}><Icon n="refresh" size={18} /></span></button>
              <button type="button" className="btn pv-csv" onClick={csv} disabled={busy}><Icon n="download" size={18} /><span>{busy ? "Preparing…" : "CSV"}</span></button>
            </div>
          </header>

          <section className="pv-bar" role="search" aria-label="Filter visits">
            <label className="pv-search"><Icon n="users" size={18} /><input type="search" placeholder="Search a student by name or username" autoComplete="off" value={f.q} onChange={(e) => set("q", e.target.value)} />{f.q && <button type="button" aria-label="Clear search" onClick={() => set("q", "")}><Icon n="x" size={16} /></button>}</label>
            <div className="pv-seg" role="group" aria-label="Time range">
              {([["today", "Today", ymd(new Date())], ["7", "7 days", daysAgo(6)], ["30", "30 days", daysAgo(29)], ["all", "All", ""]] as const).map(([k, label, from]) => (
                <button key={k} type="button" className={range === k ? "on" : ""} aria-pressed={range === k} onClick={() => setF((x) => ({ ...x, from, to: "" }))}>{label}</button>))}
            </div>
            <button type="button" className={`btn pv-more ${more ? "on" : ""}`} aria-expanded={more} aria-controls="pv-adv" onClick={() => setMore(!more)}>
              <Icon n="sliders" size={18} /><span>Filters</span>{advanced > 0 && <em>{advanced}</em>}<i className="pv-caret" aria-hidden />
            </button>
            <div id="pv-adv" className={`pv-adv ${more ? "open" : ""}`}><div className="pv-adv-in"><div className="pv-grid">
              <label className="field"><span>Class</span><select className="input" value={f.class} onChange={(e) => set("class", e.target.value)}><option value="">All classes</option>{(classes.data || []).map((c: any) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></label>
              <label className="field"><span>Screen</span><select className="input" value={f.screen} onChange={(e) => set("screen", e.target.value)}><option value="">All screens</option>{(s?.screens || []).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              <label className="field"><span>Device</span><select className="input" value={f.device} onChange={(e) => set("device", e.target.value)}><option value="">Any device</option><option value="mobile">Phone</option><option value="tablet">Tablet</option><option value="desktop">Computer</option></select></label>
              <label className="field"><span>Opened in</span><select className="input" value={f.installed} onChange={(e) => set("installed", e.target.value)}><option value="">Either</option><option value="1">Home-screen app</option><option value="0">Browser</option></select></label>
              <label className="field"><span>Stayed at least (seconds)</span><input className="input" type="number" inputMode="numeric" min={0} placeholder="e.g. 30" value={f.min_seconds} onChange={(e) => set("min_seconds", e.target.value.replace(/\D/g, ""))} /></label>
              <label className="field"><span>Sort by</span><select className="input" value={f.sort} onChange={(e) => set("sort", e.target.value)}><option value="">Newest first</option><option value="longest">Longest stay first</option></select></label>
              <label className="field"><span>From</span><input className="input" type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></label>
              <label className="field"><span>To</span><input className="input" type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></label>
            </div></div></div>
            {active.length > 0 && (
              <div className="pv-chips" aria-label="Active filters">
                {active.filter((k) => !((k === "from" || k === "to") && range !== "custom")).map((k) => (
                  <button key={k} type="button" className="pv-chip" onClick={() => set(k, "")} title="Remove this filter"><span>{LABEL[k]}:</span> {shown(k, f[k])}<Icon n="x" size={14} /></button>))}
                <button type="button" className="pv-clear" onClick={() => setF(EMPTY)}>Clear all</button>
              </div>
            )}
            {err && <p className="no" role="alert">⚠ {err}</p>}
          </section>

          {sum.error && !s ? (
            <div><ErrorNote error={sum.error} retry={sum.reload} />
              <p className="muted small pv-hint">If this page was just added, the server needs the update applied first: run <code>python manage.py migrate</code>, then restart the server.</p></div>
          ) : (
            <>
              <section className="pv-stats" aria-label="Totals">
                {first ? [0, 1, 2, 3].map((i) => <div key={i} className="pv-card pv-skel" />) : s && ([
                  ["Screen visits", <Num key="a" v={s.visits} />, "eye", 0], ["Students", <Num key="b" v={s.students} />, "users", 1],
                  ["Time on screens", <Num key="c" v={s.total_seconds} fmt={dur} />, "clock", 2], ["Average stay", <Num key="d" v={s.avg_seconds} fmt={dur} />, "activity", 3]] as const).map(([label, val, ic, i]) => (
                  <div key={label} className="pv-card pv-stat" style={{ ["--i" as any]: i }}><span className="pv-sic"><Icon n={ic} size={20} /></span><b>{val}</b><small>{label}</small></div>))}
              </section>

              {s && (
                <section className="pv-two">
                  <div className="pv-card"><h2>Most opened screens</h2>
                    {s.top_screens.length === 0 ? <p className="muted">Nothing yet.</p> : (
                      <ul className="pv-bars">{s.top_screens.map((x, i) => (
                        <li key={x.path} style={{ ["--i" as any]: i }}>
                          <button type="button" onClick={() => set("screen", f.screen === x.screen ? "" : x.screen)} className={f.screen === x.screen ? "on" : ""} title="Filter by this screen">
                            <div className="pv-row"><b><span className="pv-dot" style={{ background: `hsl(${hue(x.screen)} 65% 46%)` }} />{x.screen}</b><span>{x.visits.toLocaleString()} · {x.students} student{x.students === 1 ? "" : "s"} · avg {dur(x.avg_seconds)}</span></div>
                            <i><u style={{ width: `${Math.max(3, (x.visits / maxScreen) * 100)}%`, background: `hsl(${hue(x.screen)} 65% 46%)` }} /></i>
                          </button></li>))}</ul>)}
                  </div>
                  <div className="pv-card"><h2>Most active students</h2>
                    {s.top_students.length === 0 ? <p className="muted">Nothing yet.</p> : (
                      <ol className="pv-people">{s.top_students.map((x, i) => (
                        <li key={x.user_id} style={{ ["--i" as any]: i }}>
                          <button type="button" onClick={() => set("q", f.q === x.username ? "" : x.username)} title="Show only this student">
                            <em>{i + 1}</em><span className="pv-av" style={{ background: `hsl(${hue(x.username)} 55% 42%)` }} aria-hidden>{initials(x.student)}</span>
                            <div><b>{x.student}</b><small>{x.visits.toLocaleString()} visits · {dur(x.seconds)}</small></div></button></li>))}</ol>)}
                  </div>
                </section>
              )}

              {s && s.by_day.length > 1 && (
                <section className="pv-card"><div className="pv-ch-head"><h2>Visits per day</h2><span className="pv-read" aria-live="polite">{day ? <><b>{new Date(day.day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</b> · {day.visits.toLocaleString()} visits</> : "Tap a bar for the day"}</span></div>
                  <div className="pv-days" role="group" aria-label="Visits per day">{s.by_day.map((x, i) => (
                    <button key={x.day} type="button" className={`pv-day ${pick === i ? "on" : ""}`} style={{ ["--i" as any]: i }} onClick={() => setPick(pick === i ? null : i)} onMouseEnter={() => setPick(i)} aria-label={`${x.day}: ${x.visits} visits`}>
                      <i style={{ height: `${Math.max(5, (x.visits / maxDay) * 100)}%` }} /><span>{x.day.slice(8)}</span></button>))}</div>
                </section>
              )}
            </>
          )}

          <section className="pv-card pv-logcard">
            <div className="pv-log-head"><h2>Visit log</h2><span className="pv-count">{log.loading && !log.rows.length ? "…" : `${log.count.toLocaleString()} visits`}</span></div>
            {log.error ? <ErrorNote error={log.error} retry={log.reload} /> : log.loading && !log.rows.length ? (
              <div className="pv-skels">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="pv-skel pv-skel-row" />)}</div>
            ) : (
              <div className="pv-list" ref={log.top} aria-busy={log.busy || undefined}>
                <div className="pv-head" aria-hidden><span /><span>Student</span><span>Screen</span><span>Stayed</span><span>When</span></div>
                {log.rows.map((r: any, i: number) => row(r, i))}
                {log.rows.length === 0 && <div className="pv-empty"><span aria-hidden>🔎</span><b>No visits match</b><p>Try another time range or clear a filter.</p>{active.length > 0 && <button type="button" className="btn" onClick={() => setF(EMPTY)}>Clear filters</button>}</div>}
              </div>
            )}
            <Pager {...log.pager} />
          </section>
        </div>
      )}
    </Shell>
  );
}
