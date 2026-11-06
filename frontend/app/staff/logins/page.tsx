"use client";
import { useState } from "react";
import { BandChart, BarChart } from "@/components/LoginCharts";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const PERIODS: [number, string][] = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [180, "Last 6 months"], [365, "Last year"]];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, h) => String(h));
const dm = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const ago = (d: number | null) => (d === null ? "never" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const dailyTick = (n: number) => (n <= 14 ? 1 : n <= 35 ? 5 : n <= 100 ? 14 : n <= 200 ? 30 : 60);

function Stat({ n, label }: { n: string | number; label: string }) { return <div className="stat"><b>{n}</b>{label}</div>; }

/** One student's own picture: when she logged in, how long she went without, and at what time of day. */
function StudentView({ id, days, back }: { id: number; days: number; back: () => void }) {
  const d = useLoad(() => api<any>(`/analytics/logins/students/${id}/?days=${days}`), [id, days]);
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <ErrorNote error={d.error} retry={d.reload} />;
  const s = d.data;
  return (
    <div className="card">
      <button className="btn" onClick={back}>← All students</button>
      <h2>{s.name} <span className="muted small">{s.class} · {s.index}</span></h2>
      <div className="grid3">
        <Stat n={`${s.active_days}/${s.days}`} label="Days she logged in" />
        <Stat n={s.per_week} label="Days per week" />
        <Stat n={s.logins} label="Logins" />
        <Stat n={s.longest_gap_days} label="Longest break (days)" />
        <Stat n={ago(s.days_since)} label="Last login" />
      </div>
      <h3>Logins each day</h3>
      <BarChart values={s.daily.map((r: any) => r.logins)} labels={s.daily.map((r: any) => dm(r.date))} title="Logins per day" unit="logins" tickEvery={dailyTick(s.days)} />
      <h3>Time of day she logs in</h3>
      <BarChart values={s.hours} labels={HOURS} title="Logins by hour" unit="logins" tickEvery={3} height={140} />
    </div>
  );
}

function Students({ days, cls }: { days: number; cls: string }) {
  const [q, setQ] = useState(""), [sort, setSort] = useState("least"), [open, setOpen] = useState<number | null>(null);
  const list = usePaged<any>("/analytics/logins/students/", { days, class: cls, q, sort }, { size: 20 });
  if (open) return <StudentView id={open} days={days} back={() => setOpen(null)} />;
  return (
    <div className="card">
      <h3>Each student</h3>
      <div className="row" style={{ flexWrap: "wrap", gap: ".6rem" }}>
        <input className="input grow" type="search" placeholder="Search name or index number" aria-label="Search students" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Order" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="least">Least active first</option><option value="most">Most active first</option><option value="recent">Latest login first</option><option value="name">Name</option>
        </select>
      </div>
      {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.rows.length ? <p className="muted">No students match.</p> : (
        <>
          <div className="tbl-wrap paged" ref={list.top} aria-busy={list.busy || undefined}><table>
            <thead><tr><th>Student</th><th>Class</th><th>Days used</th><th>Per week</th><th>Logins</th><th>Last login</th></tr></thead>
            <tbody>{list.rows.map((r: any) => (
              <tr key={r.id}>
                <td><button className="btn" onClick={() => setOpen(r.id)}>{r.name}</button><br /><span className="muted small">{r.index}</span></td>
                <td>{r.class}</td>
                <td style={{ minWidth: 110 }}><b>{r.active_days}</b> <span className="muted small">of {days}</span><div className="bar" aria-hidden><i style={{ width: `${Math.min(100, (r.active_days / days) * 100)}%` }} /></div></td>
                <td>{r.per_week}</td><td>{r.logins}</td>
                <td>{r.days_since === null ? <span className="no">never</span> : ago(r.days_since)}</td>
              </tr>))}</tbody>
          </table></div>
          <Pager {...list.pager} />
        </>
      )}
    </div>
  );
}

/** How often students use the system, from the logins the audit log already records. Administrators only. */
export default function LoginActivity() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [days, setDays] = useState(30), [cls, setCls] = useState("");
  const classes = useLoad(() => (admin ? api<any[]>("/classes/") : Promise.resolve([])), [admin]);
  const o = useLoad(() => (admin ? api<any>(`/analytics/logins/?days=${days}${cls ? `&class=${cls}` : ""}`) : Promise.resolve(null)), [admin, days, cls]);
  const d = o.data;
  return (
    <Shell bare title="Login activity">
      <StaffNav />
      {!admin ? <p>Only administrators can see login activity.</p> : (
        <>
          <div className="card">
            <div className="row" style={{ flexWrap: "wrap", gap: ".6rem" }}>
              <label className="field grow"><span>Period</span><select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{PERIODS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
              <label className="field grow"><span>Class</span><select className="input" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{(classes.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            </div>
            <p className="muted small">Counts every time a student signs in, by school day in Tanzania time. A student who stays signed in on her phone counts on the day she signed in, not for every day she keeps the app open.</p>
          </div>
          {o.loading && !d ? <Loading /> : o.error || !d ? <ErrorNote error={o.error} retry={o.reload} /> : (
            <>
              <div className="grid3">
                <Stat n={`${d.active_students}/${d.students}`} label="Students who logged in" />
                <Stat n={d.never} label="Never logged in (this period)" />
                <Stat n={d.logins} label="Logins" />
                <Stat n={d.avg_days_used} label="Average days used (of those who logged in)" />
              </div>
              <div className="card"><h3>Students logging in each day</h3><p className="muted small">Number of different students who signed in on each day.</p>
                <BarChart values={d.daily.map((r: any) => r.students)} labels={d.daily.map((r: any) => dm(r.date))} title="Students who logged in per day" unit="students" tickEvery={dailyTick(d.days)} /></div>
              <div className="card"><h3>How often students use it</h3><p className="muted small">Students grouped by the number of different days they logged in during this period.</p>
                <BandChart bands={d.bands} total={d.students} /></div>
              <div className="grid2">
                <div className="card"><h3>Busiest weekdays</h3><BarChart values={d.weekdays} labels={WEEKDAYS} title="Logins by weekday" unit="logins" height={150} /></div>
                <div className="card"><h3>Busiest hours</h3><BarChart values={d.hours} labels={HOURS} title="Logins by hour of the day" unit="logins" tickEvery={3} height={150} /></div>
              </div>
              <Students days={days} cls={cls} />
            </>
          )}
        </>
      )}
    </Shell>
  );
}
