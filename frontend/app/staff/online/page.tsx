"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { PagedList } from "@/components/Pager";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { Seg, Switch } from "@/components/settings-ui";
import { CountUp, ErrorNote, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import "@/components/online.css";

type Person = {
  id: number; username: string; name: string; role: string; class: string; online: boolean; seconds_ago: number; session_minutes: number | null;
  ip: string; same_ip: number; browser: string; os: string; device_type: string; device: string; screen: string; connection: string; installed: boolean; page: string;
};
type Data = {
  counts: Record<string, number>; browsers: { name: string; count: number }[]; systems: { name: string; count: number }[]; classes: { name: string; count: number }[];
  connections: { name: string; count: number }[]; people: Person[];
};
const ROLE: Record<string, string> = { student: "Student", teacher: "Teacher", admin: "Admin", super_admin: "Admin" };
const DEV_ICON: Record<string, string> = { mobile: "phone", tablet: "layers", desktop: "building" };
const PAGE_NAMES: [string, string][] = [["/exam", "Taking an exam"], ["/practice", "Practising"], ["/staff/monitor", "Live monitor"], ["/staff", "Staff pages"], ["/results", "Results"], ["/result", "Results"], ["/badges", "Badges"], ["/settings", "Settings"], ["/messages", "Messages"], ["/", "Home"]];
const where = (p: string) => (p ? PAGE_NAMES.find(([k]) => p === k || p.startsWith(k + "/") || p.startsWith(k))?.[1] || p : "");
const ago = (s: number) => (s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : "yesterday");
const mins = (m: number | null) => (m == null ? "" : m < 1 ? "just arrived" : m < 60 ? `${m} min online` : `${Math.floor(m / 60)} h ${m % 60} min online`);
const slice = (n: number, tot: number) => (tot ? Math.max(0, Math.min(100, (n / tot) * 100)) : 0);

function Breakdown({ title, icon, rows, total }: { title: string; icon: string; rows: { name: string; count: number }[]; total: number }) {
  return (
    <section className="on-card">
      <h2><span className="on-ic"><Icon n={icon} size={16} /></span>{title}</h2>
      {rows.length === 0 ? <p className="muted small">Nobody online.</p> : rows.map((r, i) => (
        <div key={r.name} className="on-bar" style={{ "--i": i } as any}><span>{r.name}</span><b>{r.count}</b><i><u style={{ width: `${slice(r.count, total)}%` }} /></i></div>
      ))}
    </section>
  );
}

export default function Online() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [d, setD] = useState<Data | null>(null), [err, setErr] = useState<any>(null), [paused, setPaused] = useState(false), [at, setAt] = useState(0), [now, setNow] = useState(Date.now());
  const [role, setRole] = useState("all"), [dev, setDev] = useState("all"), [recent, setRecent] = useState(false), [q, setQ] = useState("");

  const load = useCallback(async () => {
    try { setD(await api<Data>("/online-now/")); setAt(Date.now()); setErr(null); } catch (e: any) { setErr(e); }
  }, []);
  useEffect(() => {
    if (!admin) return;
    load();
    const id = setInterval(() => { if (!paused && document.visibilityState === "visible") load(); }, 10_000);
    return () => clearInterval(id);
  }, [admin, paused, load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const list = useMemo(() => {
    const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (d?.people || []).filter((p) => (recent || p.online) && (role === "all" || (role === "admin" ? p.role === "admin" || p.role === "super_admin" : p.role === role)) && (dev === "all" || p.device_type === dev)
      && w.every((x) => `${p.name} ${p.username} ${p.class} ${p.ip} ${p.device} ${p.browser} ${p.os} ${ROLE[p.role]}`.toLowerCase().includes(x)));
  }, [d, role, dev, recent, q]);

  if (!admin) return <Shell bare title="Who is online"><StaffNav /><p>Only administrators can see who is online.</p></Shell>;
  const c = d?.counts;
  const total = c?.online || 0, sec = Math.max(0, Math.round((now - at) / 1000));
  return (
    <Shell bare title="Who is online">
      <StaffNav />
      <div className="onl">
        <header className="on-head">
          <div><h1>Who is online</h1><p>Everyone with the app open right now, and what they are using. Only administrators see this page.</p></div>
          <div className="on-live" role="status"><i className={paused ? "off" : ""} aria-hidden />{paused ? "Paused" : at ? `Live · updated ${sec}s ago` : "Connecting…"}
            <label><Switch label="Live updates" on={!paused} onChange={(b) => setPaused(!b)} /></label></div>
        </header>

        {err && !d ? <ErrorNote error={err} retry={load} /> : !d || !c ? <Loading /> : (
          <>
            <div className="on-hero">
              <div className="on-big"><span className="on-pulse" aria-hidden /><b><CountUp to={c.online} /></b><small>online now</small><em>{c.active_today} seen in the last 24 hours</em></div>
              <div className="on-tiles">
                {[["Students", c.students, "grad"], ["Teachers", c.teachers, "pencil"], ["Admins", c.admins, "shield"]].map(([n, v, ic], i) => (
                  <button key={n as string} type="button" className={`on-tile ${role === ({ Students: "student", Teachers: "teacher", Admins: "admin" } as any)[n as string] ? "on" : ""}`} style={{ "--i": i } as any}
                    onClick={() => setRole(role === ({ Students: "student", Teachers: "teacher", Admins: "admin" } as any)[n as string] ? "all" : ({ Students: "student", Teachers: "teacher", Admins: "admin" } as any)[n as string])}>
                    <Icon n={ic as string} size={20} /><b><CountUp to={v as number} /></b><span>{n}</span></button>))}
              </div>
              <div className="on-mix" aria-label="Device mix">
                <div className="on-mixbar" role="img" aria-label={`${c.mobile} phones, ${c.tablet} tablets, ${c.desktop} computers`}>
                  <i className="m" style={{ width: `${slice(c.mobile, total)}%` }} /><i className="t" style={{ width: `${slice(c.tablet, total)}%` }} /><i className="d" style={{ width: `${slice(c.desktop, total)}%` }} /></div>
                <div className="on-legend"><span><i className="m" />Phones {c.mobile}</span><span><i className="t" />Tablets {c.tablet}</span><span><i className="d" />Computers {c.desktop}</span><span><Icon n="download" size={13} /> Installed app {c.installed}</span></div>
              </div>
            </div>

            <div className="on-grid">
              <Breakdown title="Browsers" icon="globe" rows={d.browsers} total={total} />
              <Breakdown title="Phone / computer systems" icon="phone" rows={d.systems} total={total} />
              <Breakdown title="Students by class" icon="layers" rows={d.classes} total={d.classes.reduce((a, b) => a + b.count, 0)} />
              <Breakdown title="Connection" icon="activity" rows={d.connections} total={total} />
            </div>

            <section className="on-card on-filters" role="search">
              <Seg label="Role" value={role} onChange={setRole} opts={[["all", "All"], ["student", "Students"], ["teacher", "Teachers"], ["admin", "Admins"]]} />
              <Seg label="Device" value={dev} onChange={setDev} opts={[["all", "Any"], ["mobile", "Phones"], ["tablet", "Tablets"], ["desktop", "Computers"]]} />
              <div className="on-search"><Icon n="eye" size={16} /><input className="input" type="search" placeholder="Name, class, IP, phone model, browser…" aria-label="Search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <label className="on-recent"><Switch label="Include people seen in the last 24 hours" on={recent} onChange={setRecent} /><span>Include people seen in the last 24 hours</span></label>
            </section>

            <p className="muted small" aria-live="polite">{list.length} {list.length === 1 ? "person" : "people"} shown</p>
            {list.length === 0 ? <p className="on-empty">{total === 0 && !recent ? "Nobody is online right now." : "No one matches these filters."}</p> : (
              <PagedList as="div" className="on-list" items={list} size={24} render={(p: Person, i: number) => (
                <article key={p.id} className={`on-row ${p.online ? "live" : ""}`} style={{ "--i": i % 24 } as any}>
                  <span className={`on-av r-${p.role === "super_admin" ? "admin" : p.role}`} aria-hidden>{(p.name[0] || "?").toUpperCase()}{p.online && <i />}</span>
                  <div className="on-who"><b>{p.name}</b><small>@{p.username} · {ROLE[p.role] || p.role}{p.class ? ` · ${p.class}` : ""}</small></div>
                  <span className={`on-state ${p.online ? "up" : ""}`}>{p.online ? "Online" : ago(p.seconds_ago)}</span>
                  <div className="on-dev"><Icon n={DEV_ICON[p.device_type] || "phone"} size={16} /><span>{p.device || (p.device_type === "mobile" ? "Phone (model hidden)" : p.device_type === "tablet" ? "Tablet" : "Computer")}</span></div>
                  <div className="on-chips">
                    {p.os && <span>{p.os}</span>}{p.browser && <span>{p.browser}</span>}{p.screen && <span>{p.screen}</span>}{p.connection && <span>{p.connection}</span>}
                    {p.installed && <span className="hot">Installed app</span>}
                    {p.ip && <span title="IP address as the server sees it">IP {p.ip}{p.same_ip > 1 ? ` · ${p.same_ip} online here` : ""}</span>}
                  </div>
                  {(p.online ? (p.page || p.session_minutes != null) : false) && <small className="on-foot">{[where(p.page), mins(p.session_minutes)].filter(Boolean).join(" · ")}</small>}
                </article>)} />
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
