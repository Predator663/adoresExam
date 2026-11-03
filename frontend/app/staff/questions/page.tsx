"use client";
import { useEffect, useMemo, useState } from "react";
import QuestionEditor from "@/components/QuestionEditor";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { plain, qtypeName } from "@/lib/staff";
import { useSession } from "@/lib/session";

/** QB-09, QB-10: searchable question bank filtered by subject, topic, difficulty, type and status; Draft -> Submitted -> Approved. */
export default function Questions() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [edit, setEdit] = useState<number | "new" | null>(null);
  const [f, setF] = useState({ scope: admin ? "" : "mine", subject: "", topic: "", difficulty: "", qtype: "", status: "", q: "" });
  const allSubjects = useLoad(() => api<any[]>("/subjects/"));
  const assigned = useLoad(() => (admin ? Promise.resolve(null) : api<any[]>("/assignments/")), [admin]);
  // A teacher only gets the subjects she is assigned to; an administrator gets all of them.
  const subjects = useMemo(() => {
    const all = allSubjects.data || [];
    if (admin || !assigned.data) return { ...allSubjects, data: all };
    const ids = new Set(assigned.data.map((a: any) => a.subject));
    return { ...allSubjects, data: all.filter((x) => ids.has(x.id)) };
  }, [allSubjects, assigned.data, admin]);
  const list = usePaged<any>("/questions/", f, { size: 10 });
  const [msg, setMsg] = useState(""), [note, setNote] = useState("");
  useEffect(() => { if (admin) setF((x) => (x.scope === "mine" ? { ...x, scope: "" } : x)); }, [admin]);  // the session may load after the first render
  useEffect(() => { const e = new URLSearchParams(location.search).get("edit"); if (e) setEdit(e === "new" ? "new" : Number(e)); }, []);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function act(id: number, what: "submit" | "approve" | "reject") {
    setMsg(""); try { await api(`/questions/${id}/${what}/`, { body: {} }); list.reload(); } catch (e: any) { setMsg(e.message); }
  }
  const subjName = subjects.data?.find((s) => String(s.id) === f.subject)?.name || "";
  async function bulk(eligible: boolean) {
    if (!confirm(eligible ? `Let students practise ALL approved ${subjName} questions? Questions kept for an exam whose results are not out yet are still never offered.` : `Stop students practising any ${subjName} question?`)) return;
    setMsg(""); setNote("");
    try { const r = await api<{ updated: number }>("/practice/mark-eligible/", { body: { subject_id: Number(f.subject), eligible } }); setNote(`${r.updated} question(s) updated.`); list.reload(); } catch (e: any) { setMsg(e.message); }
  }
  async function del(id: number) {
    if (!confirm("Delete this question? A question already used in an exam is archived instead.")) return;
    try { await api(`/questions/${id}/`, { method: "DELETE" }); list.reload(); } catch (e: any) { setMsg(e.message); }
  }
  return (
    <Shell bare title="Question bank">
      <StaffNav />
      {edit !== null ? <QuestionEditor id={edit === "new" ? null : edit} onClose={() => { setEdit(null); list.reload(); }} /> : (
        <>
          <button className="btn primary" onClick={() => setEdit("new")}>+ New question</button>
          <div className="chips" role="group" aria-label="Whose questions" style={{ marginTop: ".8rem" }}>
            {([...(admin ? [["", "All questions"]] : []), ["mine", "My questions"], ["others", admin ? "Other teachers" : "Other teachers (approved)"]] as [string, string][]).map(([k, l]) =>
              <button key={k} type="button" className={`chip ${f.scope === k ? "on" : ""}`} aria-pressed={f.scope === k} onClick={() => set("scope", k)}>{l}</button>)}
          </div>
          {!admin && !subjects.data?.length && !assigned.loading && <p className="muted small">You are not assigned to any subject yet, so there are no questions to show. Ask an administrator to assign you.</p>}
          <div className="card" style={{ marginTop: ".8rem" }}>
            <div className="grid2">
              <label className="field"><span>Subject</span><select className="input" value={f.subject} onChange={(e) => set("subject", e.target.value)}><option value="">{admin ? "All" : "All my subjects"}</option>{subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="field"><span>Topic</span><input className="input" value={f.topic} onChange={(e) => set("topic", e.target.value)} /></label>
              <label className="field"><span>Difficulty</span><select className="input" value={f.difficulty} onChange={(e) => set("difficulty", e.target.value)}><option value="">All</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
              <label className="field"><span>Type</span><select className="input" value={f.qtype} onChange={(e) => set("qtype", e.target.value)}><option value="">All</option>{["mcq_single", "mcq_multi", "true_false", "matching", "fill_blank", "ordering"].map((k) => <option key={k} value={k}>{qtypeName(k)}</option>)}</select></label>
              <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}><option value="">All</option>{["draft", "submitted", "approved", "archived"].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
              <label className="field"><span>Search text</span><input className="input" value={f.q} onChange={(e) => set("q", e.target.value)} /></label>
            </div>
          </div>
          {f.subject && (
            <div className="card">
              <p className="small muted">Students can only practise <b>approved</b> questions marked <b>practice</b>. They need at least 5 for their form (lower forms top it up).</p>
              <div className="row">
                <button className="btn" onClick={() => bulk(true)}>Allow practice: all approved {subjName}</button>
                <button className="btn" onClick={() => bulk(false)}>Stop practice for {subjName}</button>
              </div>
            </div>
          )}
          {note && <p className="ok" role="status">✓ {note}</p>}
          {msg && <p className="no" role="alert">⚠ {msg}</p>}
          {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.rows.length ? <div className="card"><p className="muted">{f.scope === "mine" ? "You have not created any questions here yet." : f.scope === "others" ? "No approved questions from other teachers match." : "No questions match."}</p></div> : (
            <>
              <p className="muted small">{list.count} question(s)</p>
              <div ref={list.top} className="paged" aria-busy={list.busy || undefined}>
              {list.rows.map((q) => (
                <div key={q.id} className="card">
                  <p className="small muted">#{q.id} · {subjects.data?.find((s) => s.id === q.subject)?.name} · Form {q.form_level} · {q.topic || "—"} · {q.difficulty} · {qtypeName(q.qtype)} · {q.marks} mark(s) · {q.is_mine ? "by you" : `by ${q.created_by_name || "unknown"}`}</p>
                  <p>{plain(q.prompt).slice(0, 160) || "(image only)"}</p>
                  <div className="row"><span className="pill">{q.status}</span>{q.used_in_exam && <span className="pill">used in an exam</span>}{q.practice_eligible && <span className="pill">practice</span>}</div>
                  <div className="row" style={{ marginTop: ".5rem" }}>
                    {q.can_edit && <button className="btn" onClick={() => setEdit(q.id)}>Edit</button>}
                    {q.can_edit && q.status === "draft" && <button className="btn" onClick={() => act(q.id, "submit")}>Submit</button>}
                    {admin && q.status === "submitted" && <><button className="btn primary" onClick={() => act(q.id, "approve")}>Approve</button><button className="btn" onClick={() => act(q.id, "reject")}>Send back</button></>}
                    {q.can_edit && q.status !== "archived" && <button className="btn danger" onClick={() => del(q.id)}>Delete</button>}
                  </div>
                </div>
              ))}
              </div>
              <Pager {...list.pager} />
            </>
          )}
        </>
      )}
    </Shell>
  );
}
