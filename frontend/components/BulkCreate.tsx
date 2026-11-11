"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { blank, build, fresh, ItemRow, type S } from "./QuestionEditor";
import RichEditor from "./RichEditor";
import SymbolPad from "./SymbolPad";
import { api } from "@/lib/api";
import { useAutofix } from "@/lib/autocorrect";
import { enterToNext } from "@/lib/enterNext";
import { leftMark, rightTag } from "@/lib/labels";
import { AutofixSwitch, FillSettings, MatchSettings } from "./TypeSettings";
import { errorLines, plain, qtypeName, QTYPES, uid } from "@/lib/staff";

/** Write every question of the exam on one page, then save them all at once.
 *  Each card is a complete question (any of the six types). "Save all" creates the approved questions one by one,
 *  shows the result on each card, and puts them straight into the exam. Nothing is lost if one question has a problem:
 *  the others are saved and the problem card stays open with the reason. */

export type Card = { key: string; s: S; open: boolean; seen: boolean; state: "idle" | "saving" | "done" | "err"; errs: string[]; leaving?: boolean };
type Defaults = { form_level: number; topic: string; difficulty: string; marks: number };
/** What is kept on the server between visits: the defaults and every card still to be saved, in order, open or folded. */
export type BulkState = { defs: Defaults; cards: Card[] };

const filled = (o: { text: string; image: string | null }) => !!(o.text.trim() || o.image);
const mk = (subject: number, d: Defaults, qtype = "mcq_single"): Card => ({
  key: uid(), open: true, seen: true, state: "idle", errs: [],
  s: { ...fresh(), subject: String(subject), form_level: d.form_level, topic: d.topic, difficulty: d.difficulty, marks: d.marks, qtype },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the server needs, with empty rows dropped first (so a half-empty option list is not an error). */
function tidy(s: S): S {
  const out: S = { ...s };
  if (s.qtype === "mcq_single" || s.qtype === "mcq_multi") {
    out.options = s.options.filter(filled);
    out.correct = s.correct.filter((c) => out.options.some((o) => o.id === c));
  }
  if (s.qtype === "ordering") out.items = s.items.filter(filled);
  if (s.qtype === "matching") {
    out.left = s.left.filter(filled); out.right = s.right.filter(filled);
    const lids = new Set(out.left.map((x) => x.id)), rids = new Set(out.right.map((x) => x.id));
    out.pairs = Object.fromEntries(Object.entries(s.pairs).filter(([l, r]) => lids.has(l) && rids.has(r)));
  }
  return out;
}

/** The same rules the server applies, so problems show on the card before anything is sent. */
function problems(raw: S): string[] {
  const s = tidy(raw), out: string[] = [];
  if (!plain(s.prompt).trim() && !/<img/i.test(s.prompt)) out.push("Write the question.");
  if (s.qtype === "mcq_single" || s.qtype === "mcq_multi") {
    if (s.options.length < 2) out.push("Give at least 2 options.");
    if (!s.correct.length) out.push(s.qtype === "mcq_single" ? "Tick the correct option." : "Tick at least one correct option.");
  }
  if (s.qtype === "true_false" && s.tf === null) out.push("Say whether the statement is true or false.");
  if (s.qtype === "fill_blank") {
    const nums = s.numValue.trim() === "" || Number.isFinite(Number(s.numValue));
    if (!nums) out.push("The numeric answer must be a number.");
    if (!s.accepted.split("\n").some((x) => x.trim()) && s.numValue.trim() === "") out.push("Give at least one accepted answer.");
  }
  if (s.qtype === "ordering" && s.items.length < 2) out.push("Give at least 2 items, in the correct order.");
  if (s.qtype === "matching") {
    if (s.left.length < 2 || s.right.length < 2) out.push("Give at least 2 items on each side.");
    else if (s.left.some((l) => !s.pairs[l.id])) out.push("Choose the correct match for every left item.");
    else if (s.mUnique && new Set(s.left.map((l) => s.pairs[l.id])).size !== s.left.length) out.push("Each right item can be used once only, but two left items share a match.");
  }
  if (!(Number(s.marks) > 0)) out.push("Marks must be more than 0.");
  return out;
}

function Tick() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path className="fx-tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CardBody({ c, up }: { c: Card; up: (p: Partial<S>) => void }) {
  const fix = useAutofix() && c.s.language === "en";
  const accRef = useRef<HTMLTextAreaElement>(null);
  const s = c.s;
  const list = (key: "options" | "left" | "right" | "items", min: number, name: string, withCorrect?: boolean) => (
    <>
      {s[key].map((it, i) => (
        <ItemRow key={it.id} autofix={fix} it={it} label={`${name} ${i + 1}`} canRemove={s[key].length > min}
          onChange={(n) => up({ [key]: s[key].map((x) => (x.id === it.id ? n : x)) } as Partial<S>)}
          onRemove={() => up({ [key]: s[key].filter((x) => x.id !== it.id), correct: s.correct.filter((x) => x !== it.id) } as Partial<S>)}
          extra={withCorrect ? (s.qtype === "mcq_single"
            ? <label className="switch" title="Correct answer"><input type="radio" name={`ok-${c.key}`} checked={s.correct[0] === it.id} onChange={() => up({ correct: [it.id] })} /> ✓</label>
            : <label className="switch" title="Correct answer"><input type="checkbox" checked={s.correct.includes(it.id)} onChange={(e) => up({ correct: e.target.checked ? [...s.correct, it.id] : s.correct.filter((x) => x !== it.id) })} /> ✓</label>)
            : key === "items" ? <span className="num">{i + 1}</span> : undefined} />
      ))}
      <button type="button" className="btn" onClick={() => up({ [key]: [...s[key], ...blank(1)] } as Partial<S>)}>+ Add {name.toLowerCase()}</button>
    </>
  );
  return (
    <div className="bk-inner">
      <div className="grid2">
        <label className="field"><span>Question type</span>
          <select className="input" value={s.qtype} onChange={(e) => up({ qtype: e.target.value, correct: [] })}>{QTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Marks</span>
          <input className="input" type="number" min={0.5} step={0.5} value={s.marks} onChange={(e) => up({ marks: Number(e.target.value) })} /></label>
      </div>
      <RichEditor label="Question text" autofix={fix} value={s.prompt} onChange={(h) => up({ prompt: h })} minRows={3} />

      <h4 className="bk-h">Answer</h4>
      {(s.qtype === "mcq_single" || s.qtype === "mcq_multi") && <><p className="muted small">{s.qtype === "mcq_single" ? "Tick the one correct option." : "Tick every correct option."} Empty options are ignored.</p>{list("options", 2, "Option", true)}</>}
      {s.qtype === "true_false" && (
        <div className="row2" role="radiogroup" aria-label="Correct answer">
          {[true, false].map((b) => <label key={String(b)} className={`opt center-text ${s.tf === b ? "on" : ""}`}><input type="radio" name={`tf-${c.key}`} checked={s.tf === b} onChange={() => up({ tf: b })} />{b ? "The statement is TRUE" : "The statement is FALSE"}</label>)}
        </div>
      )}
      {s.qtype === "fill_blank" && (
        <div className="card">
          <label className="field"><span>Accepted answers (one per line; capitals and extra spaces are ignored)</span><textarea ref={accRef} className="input" rows={3} value={s.accepted} onChange={(e) => up({ accepted: e.target.value })} /></label>
          <div className="row" style={{ marginBottom: ".5rem" }}><SymbolPad target={accRef} value={s.accepted} onChange={(v) => up({ accepted: v })} /></div>
          <div className="grid2">
            <label className="field"><span>Numeric answer (optional)</span><input className="input" inputMode="decimal" value={s.numValue} onChange={(e) => up({ numValue: e.target.value })} /></label>
            <label className="field"><span>Allowed difference (±)</span><input className="input" inputMode="decimal" value={s.numTol} onChange={(e) => up({ numTol: e.target.value })} /></label>
          </div>
          <details><summary>More settings (marking, unit, hint, keyboard)</summary><FillSettings s={s} up={up} /></details>
        </div>
      )}
      {s.qtype === "ordering" && <><p className="muted small">Write the items in the CORRECT order. Students see them shuffled.</p>{list("items", 2, "Item")}</>}
      {s.qtype === "matching" && (
        <>
          <h4 className="bk-h">Column A (left side)</h4>{list("left", 2, "Left item")}
          <h4 className="bk-h">Column B (right side)</h4>{list("right", 2, "Right item")}
          <h4 className="bk-h">Correct matches</h4>
          {s.left.filter(filled).map((l, i) => (
            <div key={l.id} className="match-row"><span>{leftMark(s.mLeftStyle, i)} {plain(l.text) || l.alt_text || `Left ${i + 1}`}</span>
              <select className="input" aria-label={`Match for left item ${i + 1}`} value={s.pairs[l.id] || ""} onChange={(e) => up({ pairs: { ...s.pairs, [l.id]: e.target.value } })}>
                <option value="">Choose…</option>{s.right.filter(filled).map((r, j) => <option key={r.id} value={r.id}>{rightTag(s.mRightStyle, j)}. {plain(r.text) || r.alt_text || `Right ${j + 1}`}</option>)}</select></div>
          ))}
          <details><summary>More settings (numbering, shuffle, marking)</summary><MatchSettings s={s} up={up} /></details>
        </>
      )}

      <details className="bk-more">
        <summary>More details (topic, difficulty, explanation)</summary>
        <div className="grid2">
          <label className="field"><span>Form</span><select className="input" value={s.form_level} onChange={(e) => up({ form_level: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Form {n}</option>)}</select></label>
          <label className="field"><span>Difficulty</span><select className="input" value={s.difficulty} onChange={(e) => up({ difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
          <label className="field"><span>Topic</span><input className="input" value={s.topic} onChange={(e) => up({ topic: e.target.value })} /></label>
          <label className="field"><span>Sub-topic</span><input className="input" value={s.subtopic} onChange={(e) => up({ subtopic: e.target.value })} /></label>
        </div>
        <RichEditor label="Explanation (shown after results are published)" autofix={fix} value={s.explanation} onChange={(h) => up({ explanation: h })} minRows={2} />
      </details>
    </div>
  );
}

export default function BulkCreate({ exam, onAdd, onFinished, onReview, initial, onPersist }: {
  exam: { id: number; subject: number };
  initial?: BulkState | null;          // the batch she was writing last time (restored with its order and folded/open cards)
  onPersist?: (state: BulkState | null) => void;  // called on every change; null when nothing is left to keep
  onAdd: (qs: any[]) => void;          // each saved question goes straight into the exam
  onFinished: (saved: number) => void; // one toast at the end
  onReview: () => void;                // "Review & preview paper"
}) {
  const subject = exam.subject;
  const [defs, setDefs] = useState<Defaults>(() => initial?.defs || { form_level: 1, topic: "", difficulty: "medium", marks: 1 });
  const [cards, setCards] = useState<Card[]>(() => initial?.cards?.length
    ? initial.cards.map((c) => ({ ...c, state: "idle" as const, errs: [], leaving: false, seen: !!c.open }))
    : [mk(subject, { form_level: 1, topic: "", difficulty: "medium", marks: 1 })]);
  const [saving, setSaving] = useState(false), [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ saved: number; failed: number } | null>(null);
  const [showFlag, setShowFlag] = useState(false);
  const scrollTo = useRef<string | null>(null);

  // The batch she is writing is handed to the exam builder on every change; it stores it on the server (per teacher), so it
  // survives a closed tab, a dropped connection, logging out and coming back on another device.
  useEffect(() => {
    if (!onPersist) return;
    const keep = cards.filter((c) => c.state !== "done");
    if (keep.some((c) => plain(c.s.prompt).trim())) onPersist({ defs, cards: keep.map((c) => ({ ...c, state: "idle", errs: [], leaving: false })) });
    else onPersist(null);
  }, [cards, defs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cards.some((c) => c.state !== "done" && plain(c.s.prompt).trim()) || saving) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [cards, saving]);
  useEffect(() => { if (scrollTo.current) { document.getElementById(`bk-${scrollTo.current}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); scrollTo.current = null; } }, [cards.length]);

  const patch = (key: string, p: Partial<Card>) => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...p } : c)));
  const edit = (key: string, p: Partial<S>) => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, s: { ...c.s, ...p }, state: c.state === "err" ? "idle" : c.state } : c)));
  const add = (qtype = "mcq_single") => { const c = mk(subject, defs, qtype); scrollTo.current = c.key; setSummary(null); setCards((cs) => [...cs.map((x) => (x.state === "done" ? x : { ...x, open: !plain(x.s.prompt).trim() })), c]); };
  const remove = (key: string) => { patch(key, { leaving: true }); setTimeout(() => setCards((cs) => cs.filter((c) => c.key !== key)), 260); };
  const dup = (key: string) => setCards((cs) => {
    const i = cs.findIndex((c) => c.key === key); if (i < 0) return cs;
    const s = JSON.parse(JSON.stringify(cs[i].s)) as S;
    // new ids for every option, and the answer keys follow them
    const mapId = new Map<string, string>(); const re = (l: any[]) => l.map((o) => { const n = uid(); mapId.set(o.id, n); return { ...o, id: n }; });
    s.options = re(s.options); s.left = re(s.left); s.right = re(s.right); s.items = re(s.items);
    s.correct = s.correct.map((x) => mapId.get(x) || x); s.pairs = Object.fromEntries(Object.entries(s.pairs).map(([l, r]) => [mapId.get(l) || l, mapId.get(r as string) || (r as string)]));
    const copy: Card = { key: uid(), s, open: true, seen: true, state: "idle", errs: [] };
    scrollTo.current = copy.key;
    return [...cs.slice(0, i + 1), copy, ...cs.slice(i + 1)];
  });
  const move = (key: string, d: -1 | 1) => setCards((cs) => { const i = cs.findIndex((c) => c.key === key), j = i + d; if (i < 0 || j < 0 || j >= cs.length) return cs; const o = [...cs]; [o[i], o[j]] = [o[j], o[i]]; return o; });
  const toggle = (key: string) => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, open: !c.open, seen: true } : c)));
  const applyDefaults = () => setCards((cs) => cs.map((c) => (c.state === "done" ? c : { ...c, s: { ...c.s, form_level: defs.form_level, topic: defs.topic, difficulty: defs.difficulty, marks: defs.marks } })));

  const live = cards.filter((c) => c.state !== "done");
  const checks = useMemo(() => new Map(cards.map((c) => [c.key, problems(c.s)])), [cards]);
  const ready = live.filter((c) => !(checks.get(c.key) || []).length);
  const marks = Math.round(ready.reduce((a, c) => a + Number(c.s.marks || 0), 0) * 100) / 100;
  const incomplete = live.length - ready.length;

  async function saveAll() {
    if (saving || !ready.length) return;
    setSaving(true); setSummary(null); setShowFlag(true);
    const todo = ready.map((c) => c.key), snapshot = new Map(ready.map((c) => [c.key, c]));
    setProgress({ done: 0, total: todo.length });
    setCards((cs) => cs.map((c) => (todo.includes(c.key) ? { ...c, state: "idle", errs: [], open: false } : c)));
    let saved = 0, failed = 0;
    for (const key of todo) {
      const card = snapshot.get(key);
      if (!card) continue;
      patch(key, { state: "saving" });
      try {
        const q = await api<any>("/questions/", { body: { ...build(tidy(card.s)), submit: true } });
        patch(key, { state: "done", errs: [] });
        onAdd([q]); saved++;
      } catch (e: any) {
        failed++; patch(key, { state: "err", errs: errorLines(e.data, e.message), open: true, seen: true });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      await sleep(180);
    }
    await sleep(500);
    setCards((cs) => cs.map((c) => (c.state === "done" ? { ...c, leaving: true } : c)));
    await sleep(300);
    setCards((cs) => { const rest = cs.filter((c) => c.state !== "done"); return rest.length ? rest : [mk(subject, defs)]; });
    setSummary({ saved, failed }); setSaving(false);
    if (saved) onFinished(saved);
  }

  useEffect(() => { if (summary) setTimeout(() => document.getElementById("bk-summary")?.scrollIntoView({ behavior: "smooth", block: "center" }), 120); }, [summary]);
  const types = QTYPES;
  return (
    <div className="bk" onKeyDownCapture={enterToNext}>
      <div className="card bk-head">
        <div className="row"><h3 className="grow" style={{ margin: 0 }}>Create all the questions</h3></div>
        <p className="muted small">Write every question here, one after another. When you are done, save them all and they go straight into this exam. Then review the paper and submit it. Tip: press <b>Enter</b> to jump to the next field, <b>Shift+Enter</b> for a new line (you can switch this off in Settings).</p>
      <AutofixSwitch />
        <details className="bk-more" open={false}>
          <summary>Settings for new questions (form, topic, difficulty, marks)</summary>
          <div className="grid2">
            <label className="field"><span>Form</span><select className="input" value={defs.form_level} onChange={(e) => setDefs({ ...defs, form_level: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Form {n}</option>)}</select></label>
            <label className="field"><span>Difficulty</span><select className="input" value={defs.difficulty} onChange={(e) => setDefs({ ...defs, difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
            <label className="field"><span>Topic</span><input className="input" value={defs.topic} onChange={(e) => setDefs({ ...defs, topic: e.target.value })} /></label>
            <label className="field"><span>Marks for each</span><input className="input" type="number" min={0.5} step={0.5} value={defs.marks} onChange={(e) => setDefs({ ...defs, marks: Number(e.target.value) })} /></label>
          </div>
          <button type="button" className="btn" onClick={applyDefaults}>Apply these to all cards below</button>
        </details>
      </div>

      <div className="bk-list">
        {cards.map((c, i) => {
          const pr = checks.get(c.key) || [], ok = !pr.length, title = plain(c.s.prompt).trim();
          return (
            <article key={c.key} id={`bk-${c.key}`}
              className={`bk-card ${c.leaving ? "out" : ""} ${c.state} ${c.open ? "open" : ""}`} aria-busy={c.state === "saving" || undefined}>
              <header className="bk-top">
                <span className={`bk-num ${c.state === "done" ? "ok" : ok ? "ready" : ""}`} aria-hidden>{c.state === "done" ? <Tick /> : c.state === "saving" ? <i className="fx-spin" /> : i + 1}</span>
                <button type="button" className="bk-title" aria-expanded={c.open} onClick={() => toggle(c.key)}>
                  <b>{title ? title.slice(0, 90) : `Question ${i + 1}`}</b>
                  <span className="muted small">{qtypeName(c.s.qtype)} · {c.s.marks} mark{Number(c.s.marks) === 1 ? "" : "s"} · {c.state === "done" ? "Saved ✓" : c.state === "saving" ? "Saving…" : ok ? "Ready" : !title && !showFlag ? "Not written yet" : `Needs: ${pr[0].replace(/\.$/, "")}`}</span>
                </button>
                <span className="bk-tools">
                  <button type="button" className="btn ghost icon" aria-label="Move up" disabled={i === 0 || saving} onClick={() => move(c.key, -1)}>↑</button>
                  <button type="button" className="btn ghost icon" aria-label="Move down" disabled={i === cards.length - 1 || saving} onClick={() => move(c.key, 1)}>↓</button>
                  <button type="button" className="btn ghost icon" aria-label="Duplicate this question" disabled={saving} onClick={() => dup(c.key)} title="Duplicate">⧉</button>
                  <button type="button" className="btn ghost icon" aria-label="Remove this question" disabled={saving || (cards.length === 1 && !title)} onClick={() => remove(c.key)}>✕</button>
                  <button type="button" className={`btn ghost icon bk-chev ${c.open ? "up" : ""}`} aria-label={c.open ? "Collapse" : "Expand"} onClick={() => toggle(c.key)}>▾</button>
                </span>
              </header>
              {c.errs.length > 0 && <div className="card error bk-err" role="alert">{c.errs.map((e, k) => <p key={k}>⚠ {e}</p>)}</div>}
              <div className={`bk-body ${c.open ? "open" : ""}`}>{(c.open || c.seen) && <div className="bk-clip"><CardBody c={c} up={(p) => edit(c.key, p)} /></div>}</div>
              {c.open && showFlag && pr.length > 0 && c.state !== "done" && <ul className="bk-todo">{pr.map((x) => <li key={x}>{x}</li>)}</ul>}
            </article>
          );
        })}
      </div>

      <div className="card bk-add">
        <p className="muted small" style={{ margin: "0 0 .4rem" }}>Add the next question:</p>
        <div className="chips">
          {types.map(([k, l]) => <button key={k} type="button" className="chip bk-addchip" disabled={saving} onClick={() => add(k)}>+ {l}</button>)}
        </div>
      </div>

      {summary && (
        <div id="bk-summary" className={`fx-result ${summary.failed ? "bad" : "good"} bk-sum`} role="status">
          {summary.failed ? <div className="fx-badge"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 7v6M12 17h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></div>
            : <svg className="fx-ring" viewBox="0 0 52 52" aria-hidden><circle cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M15 27l8 8 14-16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          <div className="grow">
            <b>{summary.saved} question{summary.saved === 1 ? "" : "s"} saved and added to the exam</b>
            {summary.failed > 0 && <p>{summary.failed} could not be saved. They are still open above with the reason.</p>}
            {!summary.failed && <p className="muted small">Next: review the paper, then submit it.</p>}
          </div>
          <div className="fx-btns">{summary.saved > 0 && <button className="btn primary" onClick={onReview}>Review &amp; preview paper →</button>}<button className="btn ghost" onClick={() => setSummary(null)}>Write more</button></div>
        </div>
      )}

      <div className="bk-bar" role="region" aria-label="Save all questions">
        <div className="bk-stats">
          <span key={ready.length} className="bk-pop"><b>{ready.length}</b> ready</span>
          {incomplete > 0 && <span className="bk-warn"><b>{incomplete}</b> need{incomplete === 1 ? "s" : ""} attention</span>}
          <span className="muted"><b>{marks}</b> marks</span>
        </div>
        {saving ? (
          <div className="bk-prog" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Saving questions">
            <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /><span>Saving {Math.min(progress.done + 1, progress.total)} of {progress.total}…</span>
          </div>
        ) : (
          <button className="btn primary big bk-go" disabled={!ready.length} onClick={saveAll} onMouseEnter={() => setShowFlag(true)}>
            {ready.length ? `✓ Save ${ready.length} question${ready.length === 1 ? "" : "s"} and add to exam` : "Write a question to begin"}
          </button>
        )}
      </div>
    </div>
  );
}
