"use client";
/* Admin: a wrong answer key found AFTER the exam. Pick the question, fix the key, see exactly who it changes (a preview that changes
   nothing), then apply: every result is re-marked in one go and the students whose result moved are told. Server: exams/corrections.py. */
import { useEffect, useState } from "react";
import { Modal, useLoad } from "@/components/ui";
import { api, friendly } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import { plain } from "@/lib/staff";
import "./correct-answer.css";

const TYPE_NAME: Record<string, string> = { mcq_single: "Multiple choice (one answer)", mcq_multi: "Multiple choice (several answers)", true_false: "True or false", matching: "Matching", fill_blank: "Fill in the blank", fill_multi: "Fill in several blanks", ordering: "Put in order" };
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/** The class's own answers next to the key: a key that almost nobody matches is the usual sign that the key is wrong. */
function Bar({ n, total }: { n: number; total: number }) { return <i className="ca-bar"><u style={{ width: `${total ? Math.max(2, (n / total) * 100) : 0}%` }} /></i>; }

/** One accepted answer per line. Keeps the raw text while typing (trimming and dropping empty lines on every keystroke would eat spaces and Enter, so "Dar es Salaam" could not be typed). */
function Lines({ label, rows, value, onChange }: { label: string; rows: number; value: string[]; onChange: (v: string[]) => void }) {
  const [raw, setRaw] = useState(value.join("\n"));
  return (
    <label className="field"><span>{label}</span>
      <textarea className="input" rows={rows} value={raw} onChange={(e) => { setRaw(e.target.value); onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)); }} /></label>
  );
}

function KeyEditor({ k, ans, setAns, content, setContent }: { k: any; ans: any; setAns: (a: any) => void; content: any; setContent: (c: any) => void }) {
  const dist: Record<string, number> = k.stats?.choices || {}, total = k.stats?.answered || 0;
  const t = k.qtype;
  if (t === "mcq_single" || t === "mcq_multi") {
    const cur: string[] = t === "mcq_single" ? [ans.correct] : ans.correct || [];
    const toggle = (id: string) => setAns({ correct: t === "mcq_single" ? id : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    return (
      <div className="ca-opts" role={t === "mcq_single" ? "radiogroup" : "group"} aria-label="Correct answer">
        {(k.content.options || []).map((o: any) => (
          <button key={o.id} type="button" className={`ca-opt ${cur.includes(o.id) ? "on" : ""}`} role={t === "mcq_single" ? "radio" : "checkbox"} aria-checked={cur.includes(o.id)} onClick={() => toggle(o.id)}>
            <span className="ca-mark" aria-hidden>{cur.includes(o.id) ? "✓" : ""}</span>
            <span className="ca-otext">{plain(o.text) || "(image)"}</span>
            <span className="ca-picked">{dist[o.id] || 0} of {total} chose this<Bar n={dist[o.id] || 0} total={total} /></span>
          </button>))}
      </div>
    );
  }
  if (t === "true_false") return (
    <div className="ca-tf" role="radiogroup" aria-label="Correct answer">
      {[true, false].map((v) => (
        <button key={String(v)} type="button" role="radio" aria-checked={ans.correct === v} className={`ca-opt ${ans.correct === v ? "on" : ""}`} onClick={() => setAns({ correct: v })}>
          <span className="ca-mark" aria-hidden>{ans.correct === v ? "✓" : ""}</span><span className="ca-otext">{v ? "True" : "False"}</span><span className="ca-picked">{dist[String(v)] || 0} of {total} chose this<Bar n={dist[String(v)] || 0} total={total} /></span>
        </button>))}
    </div>
  );
  if (t === "fill_blank") {
    return (
      <div className="ca-fill">
        <Lines label="Accepted answers (one per line)" rows={4} value={ans.accepted || []} onChange={(v) => setAns({ ...ans, accepted: v })} />
        <div className="grid2">
          <label className="field"><span>Number answer: value (optional)</span><input className="input" type="number" step="any" value={ans.numeric?.value ?? ""} onChange={(e) => setAns({ ...ans, numeric: e.target.value === "" ? null : { value: Number(e.target.value), tolerance: ans.numeric?.tolerance ?? 0 } })} /></label>
          <label className="field"><span>… and how far off is still right</span><input className="input" type="number" step="any" min={0} disabled={!ans.numeric} value={ans.numeric?.tolerance ?? 0} onChange={(e) => setAns({ ...ans, numeric: { value: ans.numeric?.value ?? 0, tolerance: Math.abs(Number(e.target.value)) } })} /></label>
        </div>
      </div>
    );
  }
  if (t === "fill_multi" && k.content?.mode === "bank") {
    // Students choose words from a bank, so the right answer must be one of the bank's words (the bank itself cannot change).
    const bank: any[] = k.content.bank || [], norm = (x: string) => String(x).trim().toLowerCase().replace(/\s+/g, " ");
    const pick = (bid: string, wid: string) => {
      const w = bank.find((x) => x.id === wid);
      if (!w) return;
      const blanks = { ...ans.blanks, [bid]: { accepted: [w.text] } };
      const used = new Set(Object.values(blanks).flatMap((b: any) => (b.accepted || []).map(norm)));
      setAns({ ...ans, blanks, distractors: bank.map((x) => x.text).filter((tx) => !used.has(norm(tx))) }); // the other words are the wrong ones
    };
    return (
      <div className="ca-fill">
        <p className="muted small">Students chose words from a word bank. Pick the right word for each blank.</p>
        {(k.content.blanks || []).map((b: any, i: number) => {
          const cur = bank.find((x) => norm(x.text) === norm(ans.blanks?.[b.id]?.accepted?.[0] ?? ""));
          return (
            <label key={b.id} className="field"><span>Blank {i + 1}</span>
              <select className="input" value={cur?.id || ""} onChange={(e) => pick(b.id, e.target.value)}>
                <option value="" disabled>Choose a word…</option>{bank.map((w) => <option key={w.id} value={w.id}>{w.text}</option>)}</select></label>
          );
        })}
      </div>
    );
  }
  if (t === "fill_multi") return (
    <div className="ca-fill">
      {(k.content.blanks || []).map((b: any, i: number) => (
        <Lines key={b.id} label={`Blank ${i + 1}: accepted answers (one per line)`} rows={2} value={ans.blanks?.[b.id]?.accepted || []}
          onChange={(v) => setAns({ ...ans, blanks: { ...ans.blanks, [b.id]: { accepted: v } } })} />))}
    </div>
  );
  if (t === "matching") return (
    <div className="ca-match">
      {(k.content.left || []).map((l: any, i: number) => (
        <label key={l.id} className="field"><span>{i + 1}. {plain(l.text) || "(image)"}</span>
          <select className="input" value={ans.pairs?.[l.id] || ""} onChange={(e) => setAns({ ...ans, pairs: { ...ans.pairs, [l.id]: e.target.value } })}>
            <option value="">Choose…</option>{(k.content.right || []).map((r: any, j: number) => <option key={r.id} value={r.id}>{String.fromCharCode(65 + j)}. {plain(r.text) || "(image)"}</option>)}</select></label>))}
    </div>
  );
  if (t === "ordering") {
    const items: any[] = content.items || [];
    const move = (i: number, d: number) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setContent({ ...content, items: n }); setAns({ order: n.map((x) => x.id) }); };
    return (
      <ol className="ca-order" aria-label="Correct order, first to last">
        {items.map((it, i) => (
          <li key={it.id}><span className="ca-otext">{plain(it.text) || "(image)"}</span>
            <button type="button" className="btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button></li>))}
      </ol>
    );
  }
  return <p className="muted">This type of question cannot be corrected here.</p>;
}

function Summary({ r, done }: { r: any; done?: boolean }) {
  return (
    <div className="ca-sum">
      <div className="ca-stats">
        <div><b>{r.students}</b><span>results re-marked</span></div>
        <div className={r.changed ? "chg" : ""}><b>{r.changed}</b><span>changed</span></div>
        <div className="ca-up"><b>▲ {r.up}</b><span>went up</span></div>
        <div className="ca-down"><b>▼ {r.down}</b><span>went down</span></div>
      </div>
      {(r.pass_gained > 0 || r.pass_lost > 0) && <p className="ca-pass">{r.pass_gained > 0 && <span className="ca-up">{r.pass_gained} now pass</span>}{r.pass_lost > 0 && <span className="ca-down">{r.pass_lost} no longer pass</span>}</p>}
      {r.rows.length > 0 && (
        <div className="ca-rows" role="table" aria-label="Students whose result changes">
          {r.rows.map((x: any) => (
            <div key={x.attempt_id} className="ca-row" role="row">
              <span className="ca-who"><b>{x.student}</b><small>{x.class}</small></span>
              <span className="ca-chg">{pct(x.before.percent)} <i aria-hidden>→</i> <b className={x.after.percent >= x.before.percent ? "ca-up" : "ca-down"}>{pct(x.after.percent)}</b><small>{x.before.grade} → {x.after.grade}{x.before.passed !== x.after.passed ? (x.after.passed ? " · now passes" : " · no longer passes") : ""}</small></span>
            </div>))}
        </div>
      )}
      {r.changed === 0 && <p className="muted">Nobody's score, grade or pass mark moves, so nobody would be told.</p>}
      {(r.bank_updated || r.future_exams_updated > 0) && <p className="small">{done ? "Also fixed" : "Will also fix"}: {r.bank_updated ? "the question in the question bank" : ""}{r.bank_updated && r.future_exams_updated ? " and " : ""}{r.future_exams_updated ? `${r.future_exams_updated} exam${r.future_exams_updated === 1 ? "" : "s"} not started yet` : ""}.</p>}
      {r.also_in?.length > 0 && <div className="ca-also"><b>The same wrong key is also in:</b><ul>{r.also_in.map((x: any) => <li key={x.exam_question_id}>{x.exam} <small>(question {x.number}, {x.status})</small></li>)}</ul><small>Open each of those exams and correct it there too.</small></div>}
    </div>
  );
}

function Dialog({ exam, q, onClose, onDone }: { exam: any; q: any; onClose: () => void; onDone: () => void }) {
  const key = useLoad(() => api<any>(`/exams/${exam.id}/question-key/?eq=${q.id}`), [q.id]);
  const [ans, setAns] = useState<any>(null), [content, setContent] = useState<any>(null), [marks, setMarks] = useState(""), [expl, setExpl] = useState(""), [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true), [bank, setBank] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [res, setRes] = useState<any>(null), [applied, setApplied] = useState(false);
  const k = key.data;
  useEffect(() => { if (k && ans === null) { setAns(JSON.parse(JSON.stringify(k.answer))); setContent(JSON.parse(JSON.stringify(k.content))); setMarks(String(k.marks ?? "")); setExpl(k.explanation || ""); } }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = (preview: boolean) => ({ exam_question_id: q.id, answer: ans, ...(k?.qtype === "ordering" ? { content } : {}), marks: marks === "" ? undefined : Number(marks), explanation: expl, reason: reason.trim(), preview, notify, update_bank: bank });
  async function go(preview: boolean) {
    setBusy(true); setErr("");
    try { const r = await api<any>(`/exams/${exam.id}/correct-question/`, { body: body(preview) }); setRes(r); if (!preview) { setApplied(true); onDone(); } } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  const edited = () => { setRes(null); setErr(""); };
  const pub = exam.status === "published";

  return (
    <Modal label={`Fix the answer to question ${q.position}`} onClose={onClose}>
      <div className="ca">
        <h2>Fix the answer to question {q.position}</h2>
        {key.error ? <p className="no" role="alert">⚠ {key.error}</p> : !k ? <p className="muted">Loading…</p> : applied && res ? (
          <>
            <p className="ok ca-done" role="status">✓ Corrected. Every result was re-marked{res.visible_now ? res.changed ? " and the students whose result moved were told." : "." : ". Students will see the corrected marks when results are published."}</p>
            <Summary r={res} done />
            <button type="button" className="btn primary" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <div className="ca-q"><p className="muted small">{TYPE_NAME[k.qtype] || k.qtype} · {k.marks} mark{k.marks === 1 ? "" : "s"}{k.stats.percent_correct !== null ? ` · ${k.stats.percent_correct}% of those who answered got it fully right` : ""}</p>
              <p className="ca-prompt">{plain(k.prompt).slice(0, 400)}</p></div>
            <h3>The right answer</h3>
            {ans && <div onChangeCapture={edited} onClickCapture={edited}><KeyEditor k={k} ans={ans} setAns={setAns} content={content} setContent={setContent} /></div>}
            <details className="ca-more"><summary>Change the marks or the explanation (optional)</summary>
              <label className="field"><span>Marks for this question</span><input className="input" type="number" min={0.5} step="0.5" value={marks} onChange={(e) => { setMarks(e.target.value); edited(); }} /></label>
              <label className="field"><span>Explanation students see</span><textarea className="input" rows={3} value={expl} onChange={(e) => { setExpl(e.target.value); edited(); }} /></label></details>
            <label className="field"><span>Reason (students and teachers will see this)</span><input className="input" maxLength={300} placeholder="e.g. The key said A but B is correct" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="ca-opt2">
              <label><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell the students whose result changes{pub ? "" : " (once results are published they see the corrected mark anyway)"}</label>
              <label><input type="checkbox" checked={bank} onChange={(e) => setBank(e.target.checked)} /> Fix the question in the question bank and in exams not started yet</label>
            </div>
            {err && <p className="no" role="alert">⚠ {err}</p>}
            {res && !applied && (
              <div className="ca-preview"><h3>What this will change</h3><Summary r={res} />
                <p className="small muted">{pub ? "Results are published: students see the new mark straight away." : "Results are not published yet: nothing is shown to students until then."} Nothing has been changed yet.</p></div>
            )}
            <div className="ca-acts">
              <button type="button" className="btn" disabled={busy || !reason.trim()} onClick={() => go(true)}>{busy && !res ? "Checking…" : res ? "↻ Check again" : "👁 See what changes"}</button>
              {res && !applied && <button type="button" className="btn primary" disabled={busy} onClick={() => { if (confirm(`Apply this correction and re-mark ${res.students} result${res.students === 1 ? "" : "s"}?`)) go(false); }}>{busy ? "Applying…" : `✓ Apply and re-mark ${res.students}`}</button>}
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The "fix a wrong answer" section of an exam's admin panel (closed or published exams): a button per question, and the history of corrections. */
export default function CorrectAnswer({ exam, paper, reload }: { exam: any; paper: any[]; reload: () => void }) {
  const [open, setOpen] = useState<any>(null), [showAll, setShowAll] = useState<number | null>(null), [full, setFull] = useState<Record<number, any[]>>({}), [loadingFull, setLoadingFull] = useState(false);
  async function loadFull() {
    setLoadingFull(true);
    try { const all = await api<any[]>(`/exams/${exam.id}/corrections/?full=1`); const m: Record<number, any[]> = {}; all.forEach((c) => { m[c.id] = c.changes; }); setFull(m); } catch { /* the first 20 stay visible */ }
    setLoadingFull(false);
  }
  const hist = useLoad(() => api<any[]>(`/exams/${exam.id}/corrections/`), [exam.id]);
  return (
    <div className="ca-panel">
      <h3>Fix a wrong answer</h3>
      <p className="muted small">If a question had the wrong answer saved, fix it here. You see who it changes first; then every result is re-marked and the students are told. Use “Void” instead when the question itself is faulty.</p>
      {paper.map((p) => (
        <div key={p.id} className="ca-line"><span className="grow small">{p.position}. {plain(p.prompt).slice(0, 80)}{p.voided ? " — voided" : ""}</span>
          {!p.voided && <button type="button" className="btn" onClick={() => setOpen(p)}>✎ Fix answer</button>}</div>))}
      {hist.data && hist.data.length > 0 && (
        <div className="ca-hist"><h3>Corrections made</h3>
          {hist.data.map((c) => (
            <article key={c.id} className="ca-h">
              <header><b>Question {c.number}</b><span>{eatDate(c.created_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {c.by}</span></header>
              <p>“{c.reason}”</p>
              <p className="small muted">{c.students} results re-marked · {c.changed} changed (▲ {c.up} · ▼ {c.down}){c.notified ? ` · ${c.notified} told` : ""}{c.bank_updated ? " · bank fixed" : ""}</p>
              {c.changes.length > 0 && <button type="button" className="linkbtn" onClick={() => setShowAll(showAll === c.id ? null : c.id)}>{showAll === c.id ? "Hide students ▲" : "Show students ▼"}</button>}
              {showAll === c.id && (
                <>
                  <ul className="ca-hl">{(full[c.id] || c.changes).map((x: any, i: number) => <li key={i}><b>{x.student}</b> <small>{x.class}</small> {pct(x.before.percent)} → {pct(x.after.percent)}</li>)}</ul>
                  {!full[c.id] && c.changed > c.changes.length && <button type="button" className="linkbtn" disabled={loadingFull} onClick={() => loadFull()}>{loadingFull ? "Loading…" : `Show all ${c.changed} students`}</button>}
                </>)}
            </article>))}
        </div>
      )}
      {open && <Dialog exam={exam} q={open} onClose={() => setOpen(null)} onDone={() => { hist.reload(); reload(); }} />}
    </div>
  );
}
