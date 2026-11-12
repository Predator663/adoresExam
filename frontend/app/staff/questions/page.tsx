"use client";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import QuestionEditor from "@/components/QuestionEditor";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { ErrorNote, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { plain, qtypeName } from "@/lib/staff";
import { useSession } from "@/lib/session";

/** QB-09, QB-10: searchable question bank filtered by subject, topic, difficulty, type and status; Draft -> Submitted -> Approved.
    Laid out like the staff Exams page (ex2-* styles): header, search bar with chips and filters, card or list layout. */
const STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", archived: "Archived" };
const DIFF_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

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
  const [fopen, setFopen] = useState(false), [view, setView] = useState<"cards" | "list">("cards");
  const nFilters = [f.subject, f.topic, f.difficulty, f.qtype].filter(Boolean).length;
  const filtered = !!(f.q || f.subject || f.topic || f.difficulty || f.qtype || f.status || f.scope !== (admin ? "" : "mine"));
  const reset = () => setF({ scope: admin ? "" : "mine", subject: "", topic: "", difficulty: "", qtype: "", status: "", q: "" });
  const scopes = ([...(admin ? [["", "All questions"]] : []), ["mine", "My questions"], ["others", admin ? "Other teachers" : "Other teachers (approved)"]]) as [string, string][];
  const statuses: [string, string][] = [["", "Any status"], ["draft", "Drafts"], ["submitted", "Submitted"], ["approved", "Approved"], ["archived", "Archived"]];
  let n = 0;

  return (
    <Shell bare title="Question bank">
      <StaffNav />
      {edit !== null ? <QuestionEditor id={edit === "new" ? null : edit} onClose={() => { setEdit(null); list.reload(); }} /> : (
        <div className="ex2">
          <div className="ex2-head">
            <div className="ex2-hint"><h2>Question bank</h2><p className="muted small">{list.loading ? "Loading…" : `${list.count} question${list.count === 1 ? "" : "s"}${filtered ? " match" : " in total"}`}</p></div>
            <button className="btn" onClick={list.reload} aria-label="Refresh">↻<span className="ex2-hide-s"> Refresh</span></button>
            <button className="btn primary" onClick={() => setEdit("new")}>+ New question</button>
          </div>

          <div className="ex2-kpis" role="group" aria-label="Whose questions">
            {scopes.map(([k, l]) => (
              <button key={k || "all"} type="button" className={`ex2-kpi s-${k === "mine" ? "approved" : k === "others" ? "scheduled" : "draft"} ${f.scope === k ? "on" : ""}`} aria-pressed={f.scope === k} onClick={() => set("scope", k)}>
                <span className="ex2-kico" aria-hidden>{k === "mine" ? "✏️" : k === "others" ? "👥" : "📚"}</span><span className="q2-kl">{l}</span>
              </button>))}
          </div>
          {!admin && !subjects.data?.length && !assigned.loading && <p className="muted small">You are not assigned to any subject yet, so there are no questions to show. Ask an administrator to assign you.</p>}

          <div className="card ex2-bar">
            <div className="ex2-search">
              <input className="input" type="search" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search question text" aria-label="Search questions" />
              <button type="button" className={`btn ex2-ftoggle ${nFilters ? "on" : ""}`} aria-expanded={fopen} onClick={() => setFopen(!fopen)}>⚙ Filters{nFilters ? ` (${nFilters})` : ""}</button>
              <div className="ex2-view" role="group" aria-label="Layout">
                <button type="button" className={view === "cards" ? "on" : ""} aria-pressed={view === "cards"} onClick={() => setView("cards")} title="Cards">▦</button>
                <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")} title="List">☰</button>
              </div>
            </div>
            <div className="ex2-chips" role="group" aria-label="Status">
              {statuses.map(([k, l]) => (
                <button key={k || "any"} type="button" className={`ex2-chip q2-chip ${f.status === k ? "on" : ""}`} aria-pressed={f.status === k} onClick={() => set("status", k)}>{l}</button>))}
            </div>
            <div className={`ex2-filters ${fopen ? "open" : ""}`}>
              <label className="field"><span>Subject</span><select className="input" value={f.subject} onChange={(e) => set("subject", e.target.value)}><option value="">{admin ? "All subjects" : "All my subjects"}</option>{subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="field"><span>Topic</span><input className="input" value={f.topic} onChange={(e) => set("topic", e.target.value)} placeholder="Any topic" /></label>
              <label className="field"><span>Difficulty</span><select className="input" value={f.difficulty} onChange={(e) => set("difficulty", e.target.value)}><option value="">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
              <label className="field"><span>Type</span><select className="input" value={f.qtype} onChange={(e) => set("qtype", e.target.value)}><option value="">All types</option>{["mcq_single", "mcq_multi", "true_false", "matching", "fill_blank", "ordering"].map((k) => <option key={k} value={k}>{qtypeName(k)}</option>)}</select></label>
            </div>
            <div className="row small muted"><span role="status">{list.loading ? "Loading…" : `${list.count} question${list.count === 1 ? "" : "s"}`}</span><span className="grow" />
              {filtered && <button className="linkbtn" onClick={reset}>Clear filters</button>}</div>
          </div>

          {f.subject && (
            <div className="card q2-practice">
              <p className="small muted">Students can only practise <b>approved</b> questions marked <b>practice</b>. They need at least 5 for their form (lower forms top it up).</p>
              <div className="row">
                <button className="btn" onClick={() => bulk(true)}>Allow practice: all approved {subjName}</button>
                <button className="btn" onClick={() => bulk(false)}>Stop practice for {subjName}</button>
              </div>
            </div>
          )}
          {note && <p className="ok" role="status">✓ {note}</p>}
          {msg && <p className="no" role="alert">⚠ {msg}</p>}

          {list.error ? <ErrorNote error={list.error} retry={list.reload} />
            : list.loading ? <div className="ex2-grid" aria-hidden>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ex2-skel" />)}</div>
            : !list.rows.length ? (
              <div className="card ex2-empty">
                <span aria-hidden>{filtered ? "🔍" : "❓"}</span>
                <h3>{filtered ? "No question matches these filters" : "No questions yet"}</h3>
                <p className="muted">{f.scope === "mine" && !filtered ? "You have not created any questions here yet." : f.scope === "others" ? "No approved questions from other teachers match." : "Try a different search, or clear the filters."}</p>
                {filtered ? <button className="btn" onClick={reset}>Clear filters</button> : <button className="btn primary" onClick={() => setEdit("new")}>+ New question</button>}
              </div>
            ) : (
              <>
                <div ref={list.top} className={`ex2-grid ${view}`} aria-busy={list.busy || undefined}>
                  {list.rows.map((q) => (
                    <article key={q.id} className={`ex2-card q2-card s-${q.status}`} style={{ "--i": n++ } as CSSProperties}>
                      <div className="ex2-id">
                        <span className={`ex2-pill s-${q.status}`}><i aria-hidden />{STATUS_LABEL[q.status] || q.status}</span>
                        <h3 className="ex2-title q2-prompt">{plain(q.prompt).slice(0, 160) || "(image only)"}</h3>
                        <p className="ex2-sub"><b>{subjects.data?.find((s) => s.id === q.subject)?.name || "Subject"}</b><span className="ex2-tag">Form {q.form_level}</span>{q.topic ? <span className="ex2-tag">{q.topic}</span> : <span className="ex2-tag none">No topic</span>}</p>
                      </div>
                      <dl className="ex2-stats q2-stats">
                        <div><dt>Type</dt><dd>{qtypeName(q.qtype)}</dd></div>
                        <div><dt>Level</dt><dd>{DIFF_LABEL[q.difficulty] || q.difficulty}</dd></div>
                        <div><dt>Marks</dt><dd>{q.marks}</dd></div>
                      </dl>
                      <p className="ex2-when q2-flags">
                        {q.used_in_exam && <span className="ex2-tag">Used in an exam</span>}
                        {q.practice_eligible && <span className="ex2-tag">Practice</span>}
                        {!q.used_in_exam && !q.practice_eligible && <span className="muted">#{q.id}</span>}
                      </p>
                      <p className="ex2-by muted">{q.is_mine ? "✏️ By you" : `👤 By ${q.created_by_name || "unknown"}`} · #{q.id}</p>
                      <div className="q2-acts">
                        {q.can_edit && <button className="btn" onClick={() => setEdit(q.id)}>Edit</button>}
                        {q.can_edit && q.status === "draft" && <button className="btn primary" onClick={() => act(q.id, "submit")}>Submit</button>}
                        {admin && q.status === "submitted" && <><button className="btn primary" onClick={() => act(q.id, "approve")}>Approve</button><button className="btn" onClick={() => act(q.id, "reject")}>Send back</button></>}
                        {q.can_edit && q.status !== "archived" && <button className="btn danger" onClick={() => del(q.id)}>Delete</button>}
                      </div>
                    </article>))}
                </div>
                <Pager {...list.pager} />
              </>
            )}
        </div>
      )}
    </Shell>
  );
}
