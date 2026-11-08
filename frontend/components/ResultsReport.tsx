"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountUp, ErrorNote, Loading, Tabs, useLoad } from "@/components/ui";
import StudentAnalysis from "@/components/StudentAnalysis";
import { useToast } from "@/components/SubmitFlow";
import { API, ApiError, api, friendly, getToken, schoolHost, words } from "@/lib/api";

/** Admin: download the whole school's results (or one form / class / term / subject / exam) as PDF or Excel.
 *  Same look and motion as the exam paper save/submit flow: a progress track, a drawn tick, a toast. */

type FileKind = "pdf" | "xlsx";
type Scope = "school" | "form" | "class";
type Opts = {
  school: string; forms: number[]; classes: { id: number; label: string; form_level: number }[]; terms: { id: number; label: string }[];
  subjects: { id: number; name: string }[]; exams: { id: number; title: string; subject: number; term: number | null }[];
  sorts: { key: string; label: string; dir: "asc" | "desc" }[];
};
type Person = { rank: number; name: string; class_label: string; average: number; gpa: number | null; total_points: number | null; division: string | null; overall_grade: string | null };
type Preview = {
  school: string; filters: { label: string; value: string }[]; sort_text: string; top_n: number; students_listed: number;
  summary: { students_with_results: number; students_without_results: number; results: number; exams: number; subjects: number; average: number | null;
    highest: number | null; lowest: number | null; pass_rate: number | null; gpa: number | null; gpa_out_of: number; division_needs: number };
  grade_counts: Record<string, number>; division_counts: Record<string, number>; top: Person[]; worst: Person[];
  subjects: { subject: string; students: number; average: number | null; pass_rate: number | null; gpa: number | null; grades: Record<string, number> }[];
  classes: { label: string; students: number; average: number | null; gpa: number | null; pass_rate: number | null; grades: Record<string, number>; divisions: Record<string, number> }[];
};
type Run = { kind: FileKind; step: number; status: "busy" | "ok" | "err"; message?: string; name?: string; size?: number; url?: string };

const SECTIONS: [string, string][] = [
  ["summary", "Summary, grades and divisions"], ["top_worst", "Top and bottom students"], ["subjects", "By subject"],
  ["classes", "By class"], ["students", "Full student list"],
];
const STEPS = ["Gather results", "Build file", "Download ready"];
const LISTS = [5, 10, 15, 20, 25];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toFixed(1)}%`);
const sizeText = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

const Check = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path className="fx-tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Cross = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;

function Track({ run }: { run: Run }) {
  return (
    <ol className="fx-track" aria-label="Progress">
      {STEPS.map((l, i) => {
        const done = run.status === "ok" || i < run.step, bad = run.status === "err" && i === run.step, active = !done && !bad && run.status === "busy" && i === run.step;
        return (
          <li key={l} className={`fx-node ${done ? "done" : bad ? "bad" : active ? "active" : ""}`} aria-current={active ? "step" : undefined}>
            <span className="fx-dot">{done ? <Check /> : bad ? <Cross /> : active ? <i className="fx-spin" /> : i + 1}</span>
            <span className="fx-lab">{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Grade bars that grow from zero when the figures arrive. */
function GradeBars({ counts, label }: { counts: Record<string, number>; label: string }) {
  const keys = Object.keys(counts), max = Math.max(1, ...Object.values(counts)), total = Math.max(1, Object.values(counts).reduce((a, b) => a + b, 0));
  const [grown, setGrown] = useState(false);
  useEffect(() => { setGrown(false); const t = setTimeout(() => setGrown(true), 60); return () => clearTimeout(t); }, [counts]);
  return (
    <div className="rr-bars" role="img" aria-label={`${label}: ${keys.map((k) => `${k} ${counts[k]}`).join(", ")}`}>
      {keys.map((k, i) => (
        <div className="rr-bar-row" key={k}>
          <b className={`rr-g rr-g${Math.min(i, 5)}`}>{k}</b>
          <div className="rr-track"><i className={`rr-fill rr-g${Math.min(i, 5)}`} style={{ width: grown ? `${(counts[k] / max) * 100}%` : "0%", transitionDelay: `${i * 70}ms` }} /></div>
          <span className="rr-n"><CountUp to={counts[k]} ms={700} /> <small className="muted">{Math.round((counts[k] / total) * 100)}%</small></span>
        </div>
      ))}
    </div>
  );
}

function PeopleTable({ rows, empty }: { rows: Person[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="tbl-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Class</th><th>Avg %</th><th>GPA</th><th>Division</th></tr></thead>
      <tbody>{rows.map((p, i) => <tr key={`${p.rank}-${p.name}-${i}`} className="rr-row" style={{ animationDelay: `${i * 40}ms` }}><td>{p.rank}</td><td>{p.name}</td><td>{p.class_label}</td><td>{p.average.toFixed(1)}</td><td>{p.gpa === null ? "–" : p.gpa.toFixed(2)}</td><td>{p.division ?? "–"}</td></tr>)}</tbody></table></div>
  );
}

export default function ResultsReport() {
  const opts = useLoad(() => api<Opts>("/exports/results-report/options/"));
  const [scope, setScope] = useState<Scope>("school");
  const [form, setForm] = useState(""), [klass, setKlass] = useState(""), [term, setTerm] = useState(""), [subject, setSubject] = useState(""), [exam, setExam] = useState("");
  const [sort, setSort] = useState("rank"), [dir, setDir] = useState<"asc" | "desc">("asc"), [top, setTop] = useState(10);
  const [sections, setSections] = useState<string[]>(SECTIONS.map((s) => s[0]));
  const [empty, setEmpty] = useState(false);
  const [kind, setKind] = useState<FileKind>("pdf");
  const [tab, setTab] = useState("overview");
  const [pv, setPv] = useState<Preview | null>(null), [pvBusy, setPvBusy] = useState(false), [pvErr, setPvErr] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const { toast, show, hide } = useToast();
  const seq = useRef(0);

  const needsPick = (scope === "form" && !form) || (scope === "class" && !klass);
  const exams = useMemo(() => (opts.data?.exams || []).filter((e) => (!subject || e.subject === Number(subject)) && (!term || e.term === Number(term))), [opts.data, subject, term]);
  useEffect(() => { if (exam && !exams.some((e) => e.id === Number(exam))) setExam(""); }, [exams, exam]);

  const query = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (scope === "class" && klass) p.set("class", klass);
    if (scope === "form" && form) p.set("form", form);
    if (term) p.set("term", term);
    if (subject) p.set("subject", subject);
    if (exam) p.set("exam", exam);
    p.set("sort", sort); p.set("dir", dir); p.set("top", String(top));
    if (sections.length) p.set("sections", sections.join(","));
    if (empty) p.set("empty", "1");
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }, [scope, klass, form, term, subject, exam, sort, dir, top, sections, empty]);

  // The figures refresh by themselves a moment after any filter changes.
  useEffect(() => {
    if (!opts.data || needsPick) { setPv(null); setPvErr(""); return; }
    const mine = ++seq.current;
    setPvBusy(true);
    const t = setTimeout(() => {
      api<Preview>(`/exports/results-report/preview/?${query()}`)
        .then((d) => { if (seq.current === mine) { setPv(d); setPvErr(""); } })
        .catch((e) => { if (seq.current === mine) setPvErr(friendly(e)); })
        .finally(() => { if (seq.current === mine) setPvBusy(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [opts.data, needsPick, query]);

  useEffect(() => () => { if (run?.url) URL.revokeObjectURL(run.url); }, [run?.url]);

  const save = (url: string, name: string) => {
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };

  async function start(k: FileKind) {
    if (run?.status === "busy") return;
    if (run?.url) URL.revokeObjectURL(run.url);
    hide();
    setRun({ kind: k, step: 0, status: "busy" });
    let step = 0;
    try {
      // 1. gather: ask for the figures with exactly these filters (a clear message comes back if a filter is not allowed)
      await Promise.all([api<Preview>(`/exports/results-report/preview/?${query()}`).then(setPv), pause(450)]);
      step = 1; setRun({ kind: k, step: 1, status: "busy" });
      // 2. build the file
      const [res] = await Promise.all([
        fetch(`${API}/api/exports/results-report/?${query({ file: k })}`, { headers: { Authorization: `Token ${getToken()}`, "X-School": schoolHost() } }).catch(() => { throw new ApiError(words().network, 0, "network"); }),
        pause(450),
      ]);
      if (!res.ok) {
        let msg = words().file;
        try { const j = await res.json(); if (typeof j?.detail === "string") msg = j.detail; } catch { /* keep the plain message */ }
        throw new ApiError(res.status >= 500 ? words().server : msg, res.status);
      }
      const blob = await res.blob();
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
      const name = m ? decodeURIComponent(m[1]) : `results.${k}`;
      const url = URL.createObjectURL(blob);
      step = 2; setRun({ kind: k, step: 2, status: "ok", name, size: blob.size, url });
      save(url, name);
      show("ok", k === "pdf" ? "PDF report ready" : "Excel report ready", name);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : friendly(e);
      setRun({ kind: k, step, status: "err", message });
      show("err", "Could not make the report", message);
    }
  }

  if (opts.loading) return <Loading />;
  if (opts.error || !opts.data) return <ErrorNote error={opts.error} retry={opts.reload} />;
  const o = opts.data;
  const sortInfo = o.sorts.find((s) => s.key === sort);
  const noData = !!pv && pv.summary.results === 0;
  const canGo = !needsPick && !!sections.length && !noData && run?.status !== "busy";
  const classesInForm = scope === "class" ? o.classes : [];

  return (
    <>
      <div className="card fx-card rr-card">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>Download results</h3>
          <span className="pill">{o.school}</span>
        </div>
        <p className="muted small">Choose what to include. The figures below update by themselves, then download them as a PDF or an Excel workbook with the school name, logo and headings.</p>

        <Tabs tabs={[["school", "Whole school"], ["form", "One form"], ["class", "One class"]]} value={scope} onChange={(v) => setScope(v as Scope)} />
        <div className="rr-grid">
          {scope === "form" && (
            <label className="field rr-in"><span>Form</span>
              <select className="input" value={form} onChange={(e) => setForm(e.target.value)}><option value="">Choose a form…</option>{o.forms.map((f) => <option key={f} value={f}>Form {f} (all streams)</option>)}</select></label>
          )}
          {scope === "class" && (
            <label className="field rr-in"><span>Class</span>
              <select className="input" value={klass} onChange={(e) => setKlass(e.target.value)}><option value="">Choose a class…</option>{classesInForm.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          )}
          <label className="field"><span>Term</span>
            <select className="input" value={term} onChange={(e) => setTerm(e.target.value)}><option value="">All terms</option>{o.terms.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label className="field"><span>Subject</span>
            <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">All subjects</option>{o.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="field"><span>Exam</span>
            <select className="input" value={exam} onChange={(e) => setExam(e.target.value)}><option value="">All published exams</option>{exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
          <div className="field"><span id="rr-sort-l">Sort the student list by</span>
            <div className="row" style={{ gap: ".4rem" }}>
              <select className="input grow" aria-labelledby="rr-sort-l" value={sort} onChange={(e) => { setSort(e.target.value); setDir(o.sorts.find((s) => s.key === e.target.value)?.dir || "asc"); }}>
                {o.sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
              <button type="button" className={`btn rr-dir ${dir === "desc" ? "flip" : ""}`} onClick={() => setDir(dir === "asc" ? "desc" : "asc")}
                aria-label={`Order: ${dir === "asc" ? "low to high" : "high to low"}. Press to change.`} title={dir === "asc" ? "Low to high" : "High to low"}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <small className="muted">{sortInfo?.key === "rank" ? (dir === "asc" ? "Best student first" : "Last student first") : dir === "asc" ? "Low to high" : "High to low"}</small>
          </div>
          <label className="field"><span>Names in the top and bottom lists</span>
            <select className="input" value={top} onChange={(e) => setTop(Number(e.target.value))}>{LISTS.map((n) => <option key={n} value={n}>{n} students</option>)}</select></label>
        </div>

        <div className="field"><span id="rr-sec-l">Include in the file</span>
          <div className="chips" role="group" aria-labelledby="rr-sec-l">
            {SECTIONS.map(([k, l]) => {
              const on = sections.includes(k);
              return <button key={k} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setSections(on ? sections.filter((x) => x !== k) : SECTIONS.map((s) => s[0]).filter((x) => x === k || sections.includes(x)))}>{on ? "✓ " : ""}{l}</button>;
            })}
            <button type="button" className={`chip ${empty ? "on" : ""}`} aria-pressed={empty} onClick={() => setEmpty(!empty)}>{empty ? "✓ " : ""}Also list students with no results</button>
          </div>
        </div>
        {!sections.length && <p className="no" role="alert">Choose at least one part to include.</p>}
      </div>

      <StudentAnalysis term={term} subject={subject} exam={exam} />

      {needsPick ? (
        <div className="card rr-hint"><p className="muted">Choose {scope === "form" ? "a form" : "a class"} above to see its figures.</p></div>
      ) : (
        <div className="card rr-card" aria-busy={pvBusy || undefined}>
          <div className="row">
            <h3 className="grow" style={{ margin: 0 }}>Preview</h3>
            {pvBusy && <span className="muted small rr-sync"><i className="fx-spin" /> Updating…</span>}
          </div>
          {pvErr && <p className="no" role="alert">{pvErr}</p>}
          {!pv && !pvErr && <div className="rr-skels" aria-hidden><i /><i /><i /><i /></div>}
          {pv && (
            <div className={pvBusy ? "rr-dim" : ""}>
              <p className="muted small">{pv.filters.filter((f) => f.label !== "School").map((f) => `${f.label}: ${f.value}`).join(" · ")}</p>
              {noData ? <p className="rr-empty">No published results match these filters yet.</p> : (
                <>
                  <div className="grid3 rr-kpis">
                    <div className="stat"><b><CountUp to={pv.summary.students_with_results} /></b>Students</div>
                    <div className="stat"><b>{pct(pv.summary.average)}</b>Average</div>
                    <div className="stat"><b>{pct(pv.summary.pass_rate)}</b>Pass rate</div>
                    <div className="stat"><b>{pv.summary.gpa === null ? "–" : pv.summary.gpa.toFixed(2)}</b>GPA (of {pv.summary.gpa_out_of})</div>
                    <div className="stat"><b>{pct(pv.summary.highest)}</b>Highest</div>
                    <div className="stat"><b>{pct(pv.summary.lowest)}</b>Lowest</div>
                  </div>
                  <Tabs tabs={[["overview", "Grades & divisions"], ["top", `Top ${pv.top.length}`], ["worst", `Bottom ${pv.worst.length}`], ["subjects", "Subjects"], ["classes", "Classes"]]} value={tab} onChange={setTab} />
                  <div key={tab} className="rr-pane">
                    {tab === "overview" && (
                      <div className="rr-two">
                        <div><h4>Grades A, B, C, D, F</h4><GradeBars counts={pv.grade_counts} label="Grades" /><p className="muted small">One grade per student per subject.</p></div>
                        <div><h4>Divisions</h4><GradeBars counts={pv.division_counts} label="Divisions" /><p className="muted small">Best {pv.summary.division_needs} subjects. “Incomplete” means fewer subjects.</p></div>
                      </div>
                    )}
                    {tab === "top" && <PeopleTable rows={pv.top} empty="No students yet." />}
                    {tab === "worst" && <PeopleTable rows={pv.worst} empty="No students yet." />}
                    {tab === "subjects" && (
                      <div className="tbl-wrap"><table><thead><tr><th>Subject</th><th>Students</th><th>Avg %</th><th>Pass %</th><th>GPA</th>{Object.keys(pv.grade_counts).map((g) => <th key={g}>{g}</th>)}</tr></thead>
                        <tbody>{pv.subjects.map((s) => <tr key={s.subject}><td>{s.subject}</td><td>{s.students}</td><td>{s.average?.toFixed(1) ?? "–"}</td><td>{s.pass_rate?.toFixed(1) ?? "–"}</td><td>{s.gpa?.toFixed(2) ?? "–"}</td>{Object.keys(pv.grade_counts).map((g) => <td key={g}>{s.grades[g] ?? 0}</td>)}</tr>)}</tbody></table></div>
                    )}
                    {tab === "classes" && (
                      <div className="tbl-wrap"><table><thead><tr><th>Class</th><th>Students</th><th>Avg %</th><th>Pass %</th><th>GPA</th>{Object.keys(pv.grade_counts).map((g) => <th key={g}>{g}</th>)}</tr></thead>
                        <tbody>{pv.classes.map((c) => <tr key={c.label}><td>{c.label}</td><td>{c.students}</td><td>{c.average?.toFixed(1) ?? "–"}</td><td>{c.pass_rate?.toFixed(1) ?? "–"}</td><td>{c.gpa?.toFixed(2) ?? "–"}</td>{Object.keys(pv.grade_counts).map((g) => <td key={g}>{c.grades[g] ?? 0}</td>)}</tr>)}</tbody></table></div>
                    )}
                  </div>
                  {pv.summary.students_without_results > 0 && <p className="muted small">{pv.summary.students_without_results} student(s) in this view have no published result{empty ? " and are listed at the end of the file" : ""}.</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card fx-card paper-actions" aria-live="polite">
        <h3 style={{ margin: 0 }}>Download</h3>
        <div className="chips" role="group" aria-label="File type" style={{ marginTop: ".5rem" }}>
          {([["pdf", "PDF (print-ready)"], ["xlsx", "Excel (sort & filter)"]] as [FileKind, string][]).map(([k, l]) => (
            <button key={k} type="button" className={`chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{kind === k ? "✓ " : ""}{l}</button>
          ))}
        </div>

        {run && <Track run={run} />}

        {run?.status === "err" && (
          <div className="fx-result bad" role="alert">
            <div className="fx-badge"><Cross /></div>
            <div className="grow"><b>Could not make the report</b><p>{run.message}</p></div>
            <div className="fx-btns"><button className="btn primary" onClick={() => start(run.kind)}>Try again</button><button className="btn ghost" onClick={() => setRun(null)}>Dismiss</button></div>
          </div>
        )}

        {run?.status === "ok" && (
          <div className="fx-result good">
            <svg className="fx-ring" viewBox="0 0 52 52" aria-hidden><circle cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M15 27l8 8 14-16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div className="grow"><b>{run.kind === "pdf" ? "PDF report downloaded" : "Excel report downloaded"}</b><p className="rr-file">{run.name} · {sizeText(run.size || 0)}</p><p className="muted small">If nothing was saved, press “Save again”.</p></div>
            <div className="fx-btns">
              <button className="btn primary" onClick={() => run.url && run.name && save(run.url, run.name)}>Save again</button>
              <button className="btn" onClick={() => start(run.kind === "pdf" ? "xlsx" : "pdf")}>Make the {run.kind === "pdf" ? "Excel" : "PDF"} too</button>
              <button className="btn ghost" onClick={() => setRun(null)}>Done</button>
            </div>
          </div>
        )}

        {(!run || run.status === "busy") && (
          <div className="row fx-actions">
            <span className="grow muted small">{needsPick ? "Choose a form or class first." : noData ? "There is nothing to download for these filters yet." : !sections.length ? "Choose at least one part to include." : ""}</span>
            <button className="btn primary fx-go" disabled={!canGo} onClick={() => start(kind)}>
              {run?.status === "busy" ? "Working…" : <><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> Download {kind === "pdf" ? "PDF" : "Excel"}</>}
            </button>
          </div>
        )}
      </div>
      {toast}
    </>
  );
}
