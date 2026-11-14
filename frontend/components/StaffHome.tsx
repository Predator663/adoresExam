"use client";
/* The landing page for teachers and administrators: a greeting, what needs attention, one-tap actions, live numbers, what is
   happening now / coming up, results, subjects and (administrators) the latest activity. Refreshes itself every 30 seconds. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon from "./Icon";
import { Ring } from "./student";
import { Bar, CountUp, ErrorNote, useLoad } from "./ui";
import { api } from "@/lib/api";
import { DATETIME, ago, eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";
import "./staff-home.css";

const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
const nice = (a: string) => a.replace(/[._]/g, " ");
const hue = (h: number) => ({ "--h": h }) as CSSProperties;
const stagger = (i: number) => ({ "--i": Math.min(i, 14) }) as CSSProperties;

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" })) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Fades a block in the first time it scrolls into view. */
function Reveal({ children, className = "", d = 0, as: As = "section" }: { children: ReactNode; className?: string; d?: number; as?: any }) {
  const ref = useRef<HTMLElement>(null), [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <As ref={ref} className={`sh-in ${on ? "in" : ""} ${className}`} style={{ "--d": `${d}ms` } as CSSProperties}>{children}</As>;
}

function Card({ icon, title, sub, action, children, h = 160, d = 0, className = "" }: { icon: string; title: string; sub?: string; action?: ReactNode; children: ReactNode; h?: number; d?: number; className?: string }) {
  return (
    <Reveal className={`sh-card ${className}`} d={d}>
      <header className="sh-card-h"><span className="sh-ic" style={hue(h)}><Icon n={icon} size={20} /></span><div className="sh-card-t"><h2>{title}</h2>{sub && <small>{sub}</small>}</div>{action}</header>
      {children}
    </Reveal>
  );
}
const Empty = ({ icon, text }: { icon: string; text: string }) => <div className="sh-empty"><span><Icon n={icon} size={26} /></span><p>{text}</p></div>;

function Skeleton() {
  return <div className="sh sh-skel" role="status" aria-label="Loading"><div className="sh-hero" /><div className="sh-kpis">{Array.from({ length: 6 }, (_, i) => <i key={i} style={stagger(i)} />)}</div><div className="sh-grid"><i /><i /></div></div>;
}

export default function StaffHome({ go }: { go: (tab: string) => void }) {
  const { user, lang } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [d, setD] = useState<any>(null), [err, setErr] = useState(""), [first, setFirst] = useState(true), [at, setAt] = useState<Date | null>(null), [spin, setSpin] = useState(false);
  const subjects = useLoad(() => api<any[]>("/analytics/subjects/"));
  const load = useCallback(async () => {
    setSpin(true);
    try { setD(await api<any>("/overview/")); setErr(""); setAt(new Date()); } catch (e: any) { setErr(e.message); }
    setFirst(false); setTimeout(() => setSpin(false), 600);
  }, []);
  useEffect(() => {
    load();
    const i = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => clearInterval(i);
  }, [load]);

  if (first) return <Skeleton />;
  if (!d) return <ErrorNote error={err || "Could not load the overview."} retry={load} />;
  const T = d.totals, when = (iso: string) => eatDate(iso, DATETIME, lang);
  const name = user?.first_name || user?.username || "";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Dar_es_Salaam" });

  const attention = [
    ...(admin && T.proximity_alerts ? [{ k: "p", tone: "bad", icon: "alert", n: T.proximity_alerts, text: "Proximity alerts need a look", href: "/staff/monitor/" }] : []),
    ...(T.awaiting_scheduling ? [{ k: "a", tone: "warn", icon: "inbox", n: T.awaiting_scheduling, text: admin ? "Teacher papers are waiting to be scheduled" : "Of your papers are waiting to be scheduled", href: "/staff/exams/?status=awaiting" }] : []),
    ...(T.awaiting_results ? [{ k: "r", tone: "info", icon: "chart", n: T.awaiting_results, text: "Finished exams are waiting for results", href: "/staff/exams/?status=closed" }] : []),
  ];

  const actions: { icon: string; label: string; sub: string; href?: string; tab?: string; h: number }[] = [
    { icon: "plus", label: "New question", sub: "Type or dictate", href: "/staff/questions/", h: 160 },
    { icon: "calendar", label: "Exams", sub: "Build and schedule", href: "/staff/exams/", h: 205 },
    { icon: "activity", label: "Live monitor", sub: "Watch exams in progress", href: "/staff/monitor/", h: 10 },
    { icon: "chart", label: "Analytics", sub: "Marks and topics", href: "/staff/analytics/", h: 265 },
    ...(admin ? [
      { icon: "users", label: "People", sub: "Students and teachers", href: "/staff/people/", h: 190 },
      { icon: "phone", label: "Parents & SMS", sub: "Send login details", href: "/staff/guardians/", h: 330 },
      { icon: "megaphone", label: "Announce", sub: "Message everyone", tab: "announce", h: 35 },
      { icon: "upload", label: "Upload students", sub: "Bulk accounts", tab: "students", h: 120 },
      { icon: "download", label: "Download results", sub: "Reports and sheets", href: "/staff/reports/", h: 225 },
      { icon: "trophy", label: "Gamification", sub: "Badges and levels", href: "/staff/gamification/", h: 45 },
      { icon: "building", label: "School analytics", sub: "Whole school view", href: "/staff/school/", h: 285 },
      { icon: "shield", label: "Audit log", sub: "Who did what", href: "/staff/audit/", h: 0 },
    ] : [{ icon: "mail", label: "Messages", sub: "Notes to students", href: "/messages/", h: 330 }]),
  ];

  const kpis: { icon: string; n: number; label: string; href?: string; tone?: string; h: number }[] = [
    { icon: "radar", n: T.live_exams, label: "Live exams", href: "/staff/monitor/", tone: T.live_exams ? "good" : "", h: 150 },
    { icon: "pencil", n: T.writing_now, label: "Writing now", href: "/staff/monitor/", h: 200 },
    ...(admin ? [{ icon: "users", n: Number(T.students_online), label: "Students online", h: 250 }] : []),
    { icon: "inbox", n: T.awaiting_scheduling, label: "To schedule", href: "/staff/exams/?status=awaiting", tone: T.awaiting_scheduling ? "warn" : "", h: 40 },
    { icon: "calendar", n: T.scheduled, label: "Scheduled", href: "/staff/exams/?status=scheduled", h: 215 },
    { icon: "chart", n: T.awaiting_results, label: "Results pending", href: "/staff/exams/?status=closed", h: 290 },
    { icon: "check", n: T.submitted_today, label: "Handed in (24 h)", h: 120 },
    ...(admin ? [{ icon: "alert", n: T.proximity_alerts, label: "Proximity alerts", href: "/staff/monitor/", tone: T.proximity_alerts ? "bad" : "", h: 5 }] : []),
  ];

  return (
    <div className="sh">
      {err && <p className="no small" role="alert">⚠ Could not refresh: {err}</p>}

      <header className="sh-hero">
        <i className="sh-blob a" aria-hidden /><i className="sh-blob b" aria-hidden />
        <svg className="sh-deco" viewBox="0 0 200 200" aria-hidden><circle cx="100" cy="100" r="40" /><circle cx="100" cy="100" r="70" /><circle cx="100" cy="100" r="98" /></svg>
        <div className="sh-hero-main">
          <p className="sh-date"><Icon n="sun" size={16} /> {today}</p>
          <h1>{greeting()}{name ? `, ${name}` : ""}</h1>
          <p className="sh-sub">{T.live_exams ? `${T.live_exams} exam${T.live_exams === 1 ? " is" : "s are"} running with ${T.writing_now} student${T.writing_now === 1 ? "" : "s"} writing.` : attention.length ? "A few things are waiting for you below." : "Everything is calm. Nothing needs you right now."}</p>
          <div className="sh-chips">
            {T.live_exams > 0 && <Link href="/staff/monitor/" className="sh-chip live"><i className="sh-dot" aria-hidden />{T.live_exams} live now</Link>}
            <span className="sh-chip"><Icon n="grad" size={15} />{user?.role === "super_admin" ? "Super administrator" : admin ? "Administrator" : "Teacher"}</span>
          </div>
        </div>
        <button type="button" className="sh-refresh" onClick={load} aria-label="Refresh now" title={at ? `Updated ${eatDate(at.toISOString(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }, lang)}` : "Refresh"}>
          <span className={spin ? "spin" : ""}><Icon n="refresh" size={18} /></span><small>{at ? eatDate(at.toISOString(), TIME, lang) : ""}</small>
        </button>
      </header>

      <Reveal className="sh-attn" as="div">
        {attention.length ? attention.map((a, i) => (
          <Link key={a.k} href={a.href} className={`sh-alert ${a.tone}`} style={stagger(i)}><span className="sh-alert-ic"><Icon n={a.icon} size={22} /></span><b><CountUp to={a.n} /></b><span className="grow">{a.text}</span><Icon n="arrow" size={18} /></Link>
        )) : <div className="sh-alert ok"><span className="sh-alert-ic"><svg viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span><span className="grow"><b>All clear.</b> No papers waiting, no alerts.</span></div>}
      </Reveal>

      <Reveal as="div" d={40}>
        <h2 className="sh-h">Quick actions</h2>
        <div className="sh-actions">
          {actions.map((a, i) => {
            const body = <><span className="sh-ic big" style={hue(a.h)}><Icon n={a.icon} size={24} /></span><b>{a.label}</b><small>{a.sub}</small></>;
            return a.href ? <Link key={a.label} href={a.href} className="sh-act" style={stagger(i)}>{body}</Link>
              : <button key={a.label} type="button" className="sh-act" style={stagger(i)} onClick={() => { go(a.tab!); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{body}</button>;
          })}
        </div>
      </Reveal>

      <div className="sh-kpis">
        {kpis.map((k, i) => {
          const body = <><span className="sh-ic" style={hue(k.h)}><Icon n={k.icon} size={18} /></span><b className={k.tone || ""}><CountUp to={k.n} /></b><span className="sh-kl">{k.label}</span></>;
          return k.href ? <Link key={k.label} href={k.href} className="sh-kpi link" style={stagger(i)}>{body}</Link> : <div key={k.label} className="sh-kpi" style={stagger(i)}>{body}</div>;
        })}
      </div>

      <div className="sh-grid">
        <div className="sh-col">
          <Card icon="radar" title="Happening now" sub={T.live_exams ? `${T.live_exams} running` : "Nothing running"} h={150} action={<Link className="btn" href="/staff/monitor/">Live monitor</Link>}>
            {!d.live.length ? <Empty icon="clock" text="No exam is running right now." /> : d.live.map((e: any) => {
              const pct = e.eligible ? Math.round((e.submitted / e.eligible) * 100) : 0;
              return (
                <div key={e.id} className="sh-live">
                  <Ring value={pct} size={62} stroke={6} label={`${pct}% handed in`}><b className="sh-ring-n">{pct}%</b></Ring>
                  <div className="sh-live-b">
                    <b>{e.title}</b>
                    <small className="muted">{e.subject} · {e.classes.join(", ") || "—"} · ends {eatDate(e.end_at, TIME, lang)}</small>
                    <small><i className="sh-dot" aria-hidden /> {e.writing} writing · {e.submitted} in · {Math.max(0, e.eligible - e.writing - e.submitted)} not started</small>
                  </div>
                  <Link className="btn primary" href={`/staff/monitor/?exam=${e.id}`}><Icon n="eye" size={16} /> Watch</Link>
                </div>
              );
            })}
          </Card>

          <Card icon="inbox" title={admin ? "Teacher submissions" : "Your submissions"} sub="Awaiting scheduling" h={40} d={40} action={<Link className="btn" href="/staff/exams/?status=awaiting">All ({T.awaiting_scheduling})</Link>}>
            {!d.pending_submissions.length ? <Empty icon="check" text={admin ? "No teacher is waiting for you." : "Nothing waiting. Submit a finished paper from the exam page."} /> : (
              <ul className="sh-list">{d.pending_submissions.map((e: any, i: number) => (
                <li key={e.id} style={stagger(i)}>
                  <span className="sh-av" aria-hidden>{(e.submitted_by || "T")[0]}</span>
                  <span className="sh-li"><b>{e.title}</b><small className="muted">{e.subject} · {e.question_count} questions</small><small>{e.submitted_by || "Teacher"} · {ago(e.submitted_at, lang)}</small></span>
                  <Link className="btn primary" href={`/staff/exams/?edit=${e.id}`}>{admin ? "Review" : "Open"}</Link>
                </li>))}</ul>
            )}
          </Card>

          <Card icon="calendar" title="Coming up" sub="Scheduled exams" h={215} d={60}>
            {!d.upcoming.length ? <Empty icon="calendar" text="Nothing scheduled yet." /> : (
              <ol className="sh-time">{d.upcoming.map((e: any, i: number) => (
                <li key={e.id} style={stagger(i)}><i aria-hidden /><b>{e.title}</b><small className="muted">{e.subject} · {e.classes.join(", ") || "—"}</small><small><Icon n="clock" size={13} /> {when(e.start_at)} · {e.duration_minutes} min</small></li>))}</ol>
            )}
          </Card>
        </div>

        <div className="sh-col">
          <Card icon="chart" title="Results" sub="Closed and published" h={290} d={20}>
            {!d.awaiting_results.length && !d.recently_published.length ? <Empty icon="chart" text="No finished exams yet." /> : (
              <ul className="sh-list">
                {d.awaiting_results.map((e: any, i: number) => <li key={`w${e.id}`} style={stagger(i)}><span className="sh-li"><b>{e.title}</b><small className="muted">{e.subject} · {e.results_at ? `due ${eatDate(e.results_at, DATETIME, lang)}` : "pending"}</small></span><span className="pill warn">Closed</span></li>)}
                {d.recently_published.map((e: any, i: number) => <li key={`p${e.id}`} style={stagger(i + d.awaiting_results.length)}><span className="sh-li"><b>{e.title}</b><small className="muted">{e.subject}{e.end_at ? ` · ${when(e.end_at)}` : ""}</small></span><span className="pill">Published</span></li>)}
              </ul>
            )}
          </Card>

          <Card icon="book" title="Subjects" sub="Average mark" h={120} d={40} action={<button type="button" className="btn" onClick={() => { go("subjects"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Details</button>}>
            {subjects.loading ? <div className="sh-skel-l"><i /><i /><i /></div> : !subjects.data?.length ? <Empty icon="book" text="No subjects yet." /> : (
              <ul className="sh-subj">{subjects.data.slice(0, 6).map((s: any, i: number) => (
                <li key={s.id} style={stagger(i)}><div className="row"><span className="grow">{s.name}</span><b>{s.count ? `${Math.round(s.average)}%` : "—"}</b></div><Bar value={s.count ? s.average : 0} label={`${s.name} average`} /></li>))}</ul>
            )}
          </Card>

          {admin && (
            <Card icon="shield" title="Recent activity" sub="Latest actions" h={0} d={60} action={<Link className="btn" href="/staff/audit/">Audit log</Link>}>
              {!d.recent_activity?.length ? <Empty icon="shield" text="Nothing recorded yet." /> : (
                <ul className="sh-feed">{d.recent_activity.map((a: any, i: number) => (
                  <li key={a.id} style={stagger(i)}><i aria-hidden /><span className="grow"><b>{a.actor}</b>{a.class && <> <span className="pill">{a.class}</span></>} <span className="muted">{nice(a.action)}{a.target ? ` #${a.target}` : ""}</span></span><small className="muted">{ago(a.at, lang)}</small></li>))}</ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
