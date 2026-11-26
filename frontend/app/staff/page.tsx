"use client";
import { useState } from "react";
import { PagedList, Pager, useClientPage } from "@/components/Pager";
import { InstallBanner } from "@/components/InstallApp";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import "@/components/staff-home.css";
import StaffHome from "@/components/StaffHome";
import StudentUpload from "@/components/StudentUpload";
import { Bar, ErrorNote, Loading, useLoad, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";

/* A lean staff console. Teachers: subject results and live participation counts. Admins also: bulk student upload
   with the validation report, credential sheets, live monitor with names, announcements. Questions, exams, analytics and
   settings have their own screens (see StaffNav). */

function Subjects() {
  const { t } = useSession();
  const [open, setOpen] = useState<number | null>(null);
  const list = useLoad(() => api<any[]>("/analytics/subjects/"));
  const dash = useLoad(() => (open ? api<any>(`/analytics/subjects/${open}/`) : Promise.resolve(null)), [open]);
  const pg = useClientPage(list.data, 8);
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorNote error={list.error} retry={list.reload} />;
  return (
    <>
      <div ref={pg.top}>{pg.rows.map((s) => (
        <div key={s.id} className="card">
          <div className="row"><b className="grow">{s.name}</b><button className="btn" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? t("close") : t("details")}</button></div>
          <p className="muted">{s.count ? `${t("average")}: ${s.average}% · ${t("pass_rate")}: ${s.pass_rate}% · ${t("highest")}: ${s.highest}% · ${t("lowest")}: ${s.lowest}%` : t("no_results")}</p>
          {open === s.id && dash.data && (
            <>
              <p>{Object.entries(dash.data.grade_distribution).map(([g, n]) => `${g}: ${n}`).join("   ")}</p>
              <h3>{t("topics")}</h3>
              {dash.data.topics.map((x: any) => <div key={x.topic} style={{ margin: ".4rem 0" }}><div className="row"><span className="grow">{x.topic}</span><b>{Math.round(x.percent)}%</b></div><Bar value={x.percent} label={x.topic} /></div>)}
              <h3>{t("by_class")}</h3>
              <div className="tbl-wrap"><table><tbody>{dash.data.by_class.map((c: any, i: number) => <tr key={i}><td>{c.label || c.name}</td><td>{c.average}%</td><td>{c.count}</td></tr>)}</tbody></table></div>
            </>
          )}
        </div>
      ))}</div>
      <Pager {...pg.pager} />
    </>
  );
}

function Exams({ admin }: { admin: boolean }) {
  const { t, lang } = useSession();
  const [open, setOpen] = useState<number | null>(null);
  const list = useLoad(() => api<any[]>("/exams/"));
  const mon = useLoad(() => (open ? api<any>(`/exams/${open}/monitor/`) : Promise.resolve(null)), [open]);
  const pg = useClientPage(list.data, 8);
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorNote error={list.error} retry={list.reload} />;
  return (
    <>
      <div ref={pg.top}>{pg.rows.map((e) => (
        <div key={e.id} className="card">
          <div className="row"><span className="grow"><b>{e.title}</b><br /><span className="muted small">{e.start_at ? eatDate(e.start_at, undefined, lang) : "—"} · {e.status} · {e.question_count} {t("questions")}</span></span>
            <button className="btn" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? t("close") : t("monitor")}</button>{e.status === "live" && <a className="btn primary" href={`/staff/monitor/?exam=${e.id}`}>Live monitor</a>}</div>
          {open === e.id && mon.data && (
            <>
              <div className="grid3" style={{ marginTop: ".6rem" }}>
                <div className="stat"><b>{mon.data.not_started}</b>{t("not_started")}</div>
                <div className="stat"><b>{mon.data.in_progress}</b>{t("in_progress")}</div>
                <div className="stat"><b>{mon.data.submitted}</b>{t("submitted")}</div>
              </div>
              <button className="btn" onClick={mon.reload}>↻ {t("refresh")}</button>
              {admin && mon.data.not_started_students?.length > 0 && <><h3>{t("not_started")}</h3><PagedList items={mon.data.not_started_students} size={10} render={(s: any) => <li key={s.id}>{s.name} · {s.class}</li>} /></>}
              {admin && mon.data.connection_problems?.length > 0 && <><h3>📡 {t("connection_problems")}</h3><PagedList items={mon.data.connection_problems} size={10} render={(s: any) => <li key={s.id}>{s.name}</li>} /></>}
            </>
          )}
        </div>
      ))}</div>
      <Pager {...pg.pager} />
    </>
  );
}

function Announce() {
  const { t } = useSession();
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [msg, setMsg] = useState("");
  const past = useLoad(() => api<any[]>("/announcements/"), []);
  async function send() {
    setMsg("");
    try { const r = await api<any>("/announcements/", { body: { title, body, audience: "all" } }); setMsg(t("announce_sent", { n: r.recipients ?? "" })); setTitle(""); setBody(""); past.reload(); } catch (e: any) { setMsg(e.message); }
  }
  return (
    <>
      <div className="card"><h2>{t("announcements")}</h2>
        <p className="muted small">📢 Students see this as a pop-up at the top of their screen. It stays until each student closes it (up to 14 days). It is not added to their notifications.</p>
        <label className="field"><span>{t("title")}</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></label>
        <label className="field"><span>{t("message")}</span><textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <button className="btn primary" disabled={!title.trim() || !body.trim()} onClick={send}>{t("send_to_all")}</button>
        {msg && <p role="status">{msg}</p>}
      </div>
      {past.data && past.data.length > 0 && (
        <div className="card"><h3 style={{ marginTop: 0 }}>Sent announcements</h3>
          <div className="tbl-wrap"><table><thead><tr><th>Title</th><th>Sent</th><th>Reached</th><th>Closed by</th></tr></thead><tbody>
            {past.data.slice(0, 15).map((a) => <tr key={a.id}><td>{a.title}</td><td>{eatDate(a.created_at)}</td><td>{a.recipients}</td><td>{a.closed}</td></tr>)}
          </tbody></table></div></div>
      )}
    </>
  );
}

export default function Staff() {
  const { user, t, logout } = useSession();
  const [tab, setTab] = useState("overview");
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const tabs = [["overview", "Home"], ["subjects", t("subjects")], ["exams", t("nav_exams")], ...(admin ? [["students", t("students")], ["announce", t("announcements")]] : [])];
  return (
    <Shell bare title={t("staff_console")}>
      {user && user.role === "student" ? <p>{t("not_allowed")}</p> : (
        <>
          <StaffNav />
          <InstallBanner who={admin ? "admin" : "teacher"} />
          <div className="sh-tabs"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
          <div className="sh-pane" key={tab}>
            {tab === "overview" && <StaffHome go={setTab} />}
            {tab === "subjects" && <Subjects />}
            {tab === "exams" && <Exams admin={admin} />}
            {tab === "students" && admin && <StudentUpload />}
            {tab === "announce" && admin && <Announce />}
          </div>
          <p><button className="btn ghost" onClick={() => logout()}>{t("log_out")}</button></p>
        </>
      )}
    </Shell>
  );
}
