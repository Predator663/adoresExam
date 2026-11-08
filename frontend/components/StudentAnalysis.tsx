"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorNote, Loading } from "@/components/ui";
import { ApiError, api, friendly } from "@/lib/api";

/** Download results page: search one student, then see how many questions she got right out of how many, exam by exam, with a line for
 *  every question, her topics and subjects. Follows the term, subject and exam chosen above. Status is always a symbol AND a word, never colour alone. */

type Match = { id: number; name: string; index: string; username: string; class: string; archived: boolean; graduated: boolean; results: number };
type Status = "correct" | "partly" | "wrong" | "unanswered";
type Counts = { total: number; voided: number } & Record<Status, number>;
type Item = { number: number; type: string; topic: string; prompt: string; marks: number; awarded: number; status: Status };
type Topic = { topic: string; earned: number; possible: number; percent: number | null };
type ExamBlock = {
  result_id: number; exam_id: number; title: string; subject: string; date: string; attempt_no: number; score: number; total: number; percent: number;
  grade: string; points: number; passed: boolean; time_taken_seconds: number; questions: Counts; exam_average: number | null; exam_results: number;
  topics: Topic[]; items: Item[];
};
type Analysis = {
  student: { id: number; name: string; index: string; username: string; class: string; archived: boolean; graduated: boolean };
  summary: { exams: number; questions: number; voided: number; marks: number; marks_possible: number; average: number | null; best: number | null; lowest: number | null; passed: number } & Record<Status, number>;
  subjects: { subject: string; exams: number; questions: number; correct: number; average: number; marks: number; possible: number }[];
  topics: Topic[]; exams: ExamBlock[];
};

/** A 404 here means the server has not been updated with the student lookup yet: say so, instead of a vague "something went wrong". */
const explain = (e: unknown) => (e instanceof ApiError && (e.status === 404 || e.status === 405)
  ? "The student lookup is not on the server yet. Update the backend with analytics/studentanalysis.py and analytics/urls.py, restart it, then reload this page."
  : friendly(e));

const MARK: Record<Status, [string, string]> = { correct: ["✓", "Correct"], partly: ["◐", "Partly"], wrong: ["✗", "Wrong"], unanswered: ["–", "Not answered"] };
const ORDER: Status[] = ["correct", "partly", "wrong", "unanswered"];
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toFixed(1)}%`);
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const minutes = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });

/** One bar split into correct / partly / wrong / not answered, with the same numbers written out for screen readers. */
function Split({ c, total }: { c: Record<Status, number>; total: number }) {
  const label = ORDER.map((k) => `${c[k]} ${MARK[k][1].toLowerCase()}`).join(", ");
  return (
    <div className="sa-split" role="img" aria-label={`Of ${total} questions: ${label}`}>
      {ORDER.map((k) => (c[k] ? <i key={k} className={`sa-${k}`} style={{ flexGrow: c[k] }} /> : null))}
    </div>
  );
}

function Legend({ c }: { c: Record<Status, number> }) {
  return (
    <p className="sa-legend small">{ORDER.map((k) => <span key={k} className={`sa-key sa-${k}-t`}><b aria-hidden>{MARK[k][0]}</b> {MARK[k][1]}: <b>{c[k]}</b></span>)}</p>
  );
}

function ExamCard({ e, open }: { e: ExamBlock; open: boolean }) {
  const q = e.questions;
  return (
    <details className="sa-exam" open={open}>
      <summary>
        <span className="sa-title"><b>{e.title}</b> <span className="muted small">{e.subject} · {day(e.date)}{e.attempt_no > 1 ? ` · attempt ${e.attempt_no}` : ""}</span></span>
        <span className="sa-score"><b>{q.correct}</b> of <b>{q.total}</b> correct <span className="pill">{e.grade}</span></span>
      </summary>
      <Split c={q} total={q.total} />
      <Legend c={q} />
      <p className="small">
        Marks <b>{num(e.score)}</b> out of <b>{num(e.total)}</b> (<b>{pct(e.percent)}</b>) · {e.passed ? "Passed" : "Did not pass"} · Time {minutes(e.time_taken_seconds)}
        {e.exam_average !== null && <> · All students in this exam averaged <b>{pct(e.exam_average)}</b> ({e.exam_results} result{e.exam_results === 1 ? "" : "s"})</>}
        {q.voided > 0 && <> · {q.voided} question{q.voided === 1 ? " was" : "s were"} cancelled and not counted</>}
      </p>
      {e.topics.length > 0 && (
        <div className="tbl-wrap"><table><caption className="small muted">By topic in this exam</caption>
          <thead><tr><th>Topic</th><th>Marks</th><th>%</th></tr></thead>
          <tbody>{e.topics.map((t) => <tr key={t.topic}><td>{t.topic}</td><td>{num(t.earned)} / {num(t.possible)}</td><td>{pct(t.percent)}</td></tr>)}</tbody></table></div>
      )}
      <div className="tbl-wrap"><table><caption className="small muted">Every question</caption>
        <thead><tr><th>No.</th><th>Question</th><th>Topic</th><th>Marks</th><th>Result</th></tr></thead>
        <tbody>{e.items.map((i) => (
          <tr key={i.number} className={`sa-row sa-${i.status}-r`}>
            <td>{i.number}</td><td>{i.prompt || "–"}</td><td>{i.topic}</td><td>{num(i.awarded)} / {num(i.marks)}</td>
            <td className={`sa-${i.status}-t`}><b aria-hidden>{MARK[i.status][0]}</b> {MARK[i.status][1]}</td>
          </tr>))}</tbody></table></div>
    </details>
  );
}

export default function StudentAnalysis({ term, subject, exam }: { term: string; subject: string; exam: string }) {
  const [q, setQ] = useState(""), [matches, setMatches] = useState<Match[] | null>(null), [searchErr, setSearchErr] = useState("");
  const [picked, setPicked] = useState<Match | null>(null);
  const [data, setData] = useState<Analysis | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const seq = useRef(0), seqA = useRef(0);

  const filters = () => {
    const p = new URLSearchParams();
    if (term) p.set("term", term);
    if (subject) p.set("subject", subject);
    if (exam) p.set("exam", exam);
    return p;
  };

  // Look for matching students a moment after she stops typing.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setMatches(null); setSearchErr(""); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      const p = filters(); p.set("q", text);
      api<{ results: Match[] }>(`/exports/results-report/students/?${p}`)
        .then((d) => { if (seq.current === mine) { setMatches(d.results); setSearchErr(""); } })
        .catch((e) => { if (seq.current === mine) setSearchErr(explain(e)); });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, term, subject, exam]);

  // Her analysis loads when she is picked, and again when the term, subject or exam above changes.
  useEffect(() => {
    if (!picked) { setData(null); return; }
    const mine = ++seqA.current;
    setBusy(true); setErr("");
    api<Analysis>(`/exports/results-report/students/${picked.id}/?${filters()}`)
      .then((d) => { if (seqA.current === mine) setData(d); })
      .catch((e) => { if (seqA.current === mine) setErr(explain(e)); })
      .finally(() => { if (seqA.current === mine) setBusy(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, term, subject, exam]);

  const s = data?.summary;
  return (
    <div className="card rr-card sa-card" aria-busy={busy || undefined}>
      <h3 style={{ margin: 0 }}>Look up one student</h3>
      <p className="muted small">Type a name, username or index number to see how many questions she got right in each exam, with a line for every question. It follows the term, subject and exam chosen above.</p>
      <label className="field"><span>Student</span>
        <input className="input" type="search" autoComplete="off" placeholder="At least two letters" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {searchErr && <p className="no" role="alert">⚠ {searchErr}</p>}
      {matches && (
        <ul className="sa-matches" aria-label="Matching students" aria-live="polite">
          {matches.length === 0 && <li className="muted">No student matches “{q.trim()}”.</li>}
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className={`btn sa-match ${picked?.id === m.id ? "primary" : ""}`} aria-pressed={picked?.id === m.id} onClick={() => setPicked(m)}>
                <b>{m.name}</b> <span className="small">{m.class || "no class"}{m.index ? ` · ${m.index}` : ""}</span>
                <span className="small"> · {m.results} result{m.results === 1 ? "" : "s"}{m.archived ? " · archived" : m.graduated ? " · graduated" : ""}</span>
              </button>
            </li>))}
        </ul>
      )}

      {picked && busy && !data && <Loading />}
      {err && <ErrorNote error={err} retry={() => setPicked({ ...picked! })} />}
      {data && s && (
        <div className="sa-body">
          <div className="row" style={{ alignItems: "baseline" }}>
            <h4 className="grow" style={{ margin: 0 }}>{data.student.name}</h4>
            <span className="muted small">{data.student.class || "no class"}{data.student.index ? ` · ${data.student.index}` : ""}</span>
          </div>
          {s.exams === 0 ? (
            <p className="rr-empty">No published results for her in this selection. Change the term, subject or exam above, or wait until the exam results are published.</p>
          ) : (
            <>
              <p className="sa-big" aria-live="polite"><b>{s.correct}</b> of <b>{s.questions}</b> questions correct <span className="muted small">in {s.exams} exam{s.exams === 1 ? "" : "s"}</span></p>
              <Split c={s} total={s.questions} />
              <Legend c={s} />
              <p className="small">
                Marks <b>{num(s.marks)}</b> out of <b>{num(s.marks_possible)}</b> · Average <b>{pct(s.average)}</b> · Best <b>{pct(s.best)}</b> · Lowest <b>{pct(s.lowest)}</b> · Passed <b>{s.passed}</b> of <b>{s.exams}</b>
                {s.voided > 0 && <> · {s.voided} cancelled question{s.voided === 1 ? "" : "s"} not counted</>}
              </p>

              {data.subjects.length > 1 && (
                <div className="tbl-wrap"><table><caption className="small muted">By subject</caption>
                  <thead><tr><th>Subject</th><th>Exams</th><th>Questions correct</th><th>Marks</th><th>Average</th></tr></thead>
                  <tbody>{data.subjects.map((x) => <tr key={x.subject}><td>{x.subject}</td><td>{x.exams}</td><td>{x.correct} of {x.questions}</td><td>{num(x.marks)} / {num(x.possible)}</td><td>{pct(x.average)}</td></tr>)}</tbody></table></div>
              )}
              {data.topics.length > 0 && (
                <div className="tbl-wrap"><table><caption className="small muted">Topics, weakest first</caption>
                  <thead><tr><th>Topic</th><th>Marks</th><th>%</th></tr></thead>
                  <tbody>{data.topics.map((t) => <tr key={t.topic}><td>{t.topic}</td><td>{num(t.earned)} / {num(t.possible)}</td><td>{pct(t.percent)}</td></tr>)}</tbody></table></div>
              )}

              <h4>Exam by exam</h4>
              {data.exams.map((e) => <ExamCard key={e.result_id} e={e} open={data.exams.length === 1} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
