"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import QuestionView from "./QuestionView";
import RichEditor, { uploadImage } from "./RichEditor";
import SymbolPad from "./SymbolPad";
import { ErrorNote, Loading, useLoad } from "./ui";
import { api, mediaUrl } from "@/lib/api";
import { errorLines, plain, QTYPES, uid } from "@/lib/staff";
import { useSession } from "@/lib/session";
import { useAutofix } from "@/lib/autocorrect";
import { enterToNext } from "@/lib/enterNext";
import { leftMark, letters, matchLayout, rightMark, rightTag, type LeftStyle, type RightStyle } from "@/lib/labels";
import { AutofixSwitch, FillSettings, MatchSettings } from "./TypeSettings";
import type { Question } from "@/lib/types";

export type Item = { id: string; text: string; image: string | null; alt_text: string };
export type S = {
  subject: string; form_level: number; topic: string; subtopic: string; difficulty: string; marks: number; language: string; qtype: string;
  practice_eligible: boolean; prompt: string; explanation: string;
  options: Item[]; correct: string[]; tf: boolean | null; left: Item[]; right: Item[]; pairs: Record<string, string>;
  accepted: string; numValue: string; numTol: string; items: Item[];
  // matching: layout and marking
  mLeftStyle: LeftStyle; mRightStyle: RightStyle; mLeftTitle: string; mRightTitle: string; mShuffle: boolean; mUnique: boolean; mPartial: "" | "all" | "per_pair";
  // fill in the blank: answer box and marking
  fCase: boolean; fPunct: boolean; fUnit: string; fHint: string; fInput: "text" | "number"; fWidth: "short" | "medium" | "long";
};
export const blank = (n = 4): Item[] => Array.from({ length: n }, () => ({ id: uid(), text: "", image: null, alt_text: "" }));
export const fresh = (): S => ({ subject: "", form_level: 1, topic: "", subtopic: "", difficulty: "medium", marks: 1, language: "en", qtype: "mcq_single", practice_eligible: true, prompt: "", explanation: "",
  options: blank(4), correct: [], tf: null, left: blank(3), right: blank(3), pairs: {}, accepted: "", numValue: "", numTol: "0", items: blank(3),
  mLeftStyle: "roman", mRightStyle: "LETTER", mLeftTitle: "", mRightTitle: "", mShuffle: true, mUnique: false, mPartial: "",
  fCase: false, fPunct: false, fUnit: "", fHint: "", fInput: "text", fWidth: "medium" });
const fromApi = (q: any): S => {
  const s = fresh();
  Object.assign(s, { subject: String(q.subject), form_level: q.form_level, topic: q.topic, subtopic: q.subtopic, difficulty: q.difficulty, marks: q.marks, language: q.language, qtype: q.qtype, practice_eligible: q.practice_eligible, prompt: q.prompt, explanation: q.explanation });
  const dec = (l: any[]) => l.map((o) => ({ id: o.id, text: o.text || "", image: o.image || null, alt_text: o.alt_text || "" }));
  if (q.content?.options) s.options = dec(q.content.options);
  if (q.content?.left) {
    s.left = dec(q.content.left); s.right = dec(q.content.right); s.pairs = q.answer.pairs;
    const lay = matchLayout(q.content);
    Object.assign(s, { mLeftStyle: lay.left_style, mRightStyle: lay.right_style, mLeftTitle: lay.left_title, mRightTitle: lay.right_title, mShuffle: lay.shuffle_right, mUnique: lay.unique, mPartial: q.answer.partial || "" });
  }
  if (q.content?.items) s.items = dec(q.content.items);
  if (q.qtype === "mcq_single") s.correct = [q.answer.correct]; if (q.qtype === "mcq_multi") s.correct = q.answer.correct;
  if (q.qtype === "true_false") s.tf = q.answer.correct;
  if (q.qtype === "fill_blank") { s.accepted = (q.answer.accepted || []).join("\n"); if (q.answer.numeric) { s.numValue = String(q.answer.numeric.value); s.numTol = String(q.answer.numeric.tolerance); }
    Object.assign(s, { fCase: !!q.answer.case_sensitive, fPunct: !!q.answer.ignore_punct, fUnit: q.content?.unit || "", fHint: q.content?.hint || "", fInput: q.content?.input === "number" ? "number" : "text", fWidth: q.content?.width || "medium" }); }
  return s;
};
/** True while nothing has been typed yet (so an untouched editor is not stored as a draft). */
export function isBlank(s: S): boolean {
  const empty = (l: Item[]) => l.every((o) => !o.text.trim() && !o.image);
  return !plain(s.prompt) && !/<img/i.test(s.prompt) && !plain(s.explanation) && !s.topic.trim() && !s.subtopic.trim()
    && empty(s.options) && empty(s.left) && empty(s.right) && empty(s.items) && !s.accepted.trim() && s.numValue === "" && s.tf === null && !s.correct.length;
}
const enc = (l: Item[]) => l.map((o) => ({ id: o.id, text: o.text, image: o.image, alt_text: o.alt_text }));

export function build(s: S) {
  let content: any = {}, answer: any = {};
  if (s.qtype === "mcq_single" || s.qtype === "mcq_multi") { content = { options: enc(s.options.filter((o) => o.text.trim() || o.image)) }; answer = { correct: s.qtype === "mcq_single" ? s.correct[0] : s.correct }; }
  if (s.qtype === "true_false") answer = { correct: s.tf };
  if (s.qtype === "matching") { 
    content = { left: enc(s.left), right: enc(s.right), layout: { left_style: s.mLeftStyle || "roman", right_style: s.mRightStyle || "LETTER", left_title: s.mLeftTitle || "", right_title: s.mRightTitle || "", shuffle_right: s.mShuffle !== false, unique: !!s.mUnique } };
    answer = { pairs: s.pairs, partial: s.mPartial || null };
  }
  if (s.qtype === "fill_blank") {
    content = { unit: s.fUnit || "", hint: s.fHint || "", input: s.fInput || "text", width: s.fWidth || "medium" };
    answer = { accepted: s.accepted.split("\n").map((x) => x.trim()).filter(Boolean), numeric: s.numValue !== "" ? { value: Number(s.numValue), tolerance: Number(s.numTol || 0) } : null, case_sensitive: !!s.fCase, ignore_punct: !!s.fPunct };
  }
  if (s.qtype === "ordering") { content = { items: enc(s.items) }; answer = {}; }
  return { subject: Number(s.subject), form_level: s.form_level, topic: s.topic, subtopic: s.subtopic, difficulty: s.difficulty, marks: s.marks, language: s.language, qtype: s.qtype,
    practice_eligible: s.practice_eligible, prompt: s.prompt, explanation: s.explanation, content, answer };
}

/** One entry (option, matching item, ordering item): text and/or an image with required description (QB-02, QB-03). */
export function ItemRow({ it, onChange, onRemove, extra, label, canRemove, autofix, tag }: { autofix?: boolean; tag?: string; it: Item; onChange: (i: Item) => void; onRemove?: () => void; extra?: React.ReactNode; label: string; canRemove: boolean }) {
  const [err, setErr] = useState("");
  async function pick(f?: File) {
    if (!f) return;
    const alt = it.alt_text || window.prompt("Short description of this image (for screen readers):") || "";
    if (!alt.trim()) return setErr("A description is required.");
    try { const r = await uploadImage(f, alt); onChange({ ...it, image: r.url, alt_text: alt }); setErr(""); } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="card" style={{ padding: ".6rem" }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        {tag && <span className="optletter" aria-hidden>{tag}</span>}
        {extra}
        {/* answers can hold symbols, powers, subscripts, fractions, roots and chemical formulas (the server cleans the HTML) */}
        <RichEditor compact autofix={autofix} label={label} value={it.text} onChange={(h) => onChange({ ...it, text: h })} />
        {canRemove && <button type="button" className="btn danger icon" aria-label={`Remove ${label}`} onClick={onRemove}>✕</button>}
      </div>
      <div className="row" style={{ marginTop: ".4rem" }}>
        {it.image ? <><img src={mediaUrl(it.image)} alt={it.alt_text} className="thumb" style={{ maxHeight: 60 }} />
          <input className="input grow" aria-label="Image description" value={it.alt_text} onChange={(e) => onChange({ ...it, alt_text: e.target.value })} />
          <button type="button" className="btn" onClick={() => onChange({ ...it, image: null, alt_text: "" })}>Remove image</button></>
          : <label className="btn">🖼 Add image<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>}
      </div>
      {err && <p className="no small" role="alert">{err}</p>}
    </div>
  );
}

/** `subject` + `onCreated` make it the embedded editor inside the exam builder: the subject is fixed, and the
 *  question is saved, approved and handed back so the builder can add it to the current exam. */
export default function QuestionEditor({ id, onClose, subject, onCreated, backLabel, initial, onDraft }: { id: number | null; onClose: () => void; subject?: number; onCreated?: (q: any) => void; backLabel?: string;
  /** Embedded in the exam builder: the question she was typing last time, and where to report every change so it is kept on the server. */
  initial?: S | null; onDraft?: (s: S) => void }) {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const subjects = useLoad(() => api<any[]>("/subjects/"));
  const assigned = useLoad(() => (admin ? Promise.resolve(null) : api<any[]>("/assignments/")), [admin]);
  const existing = useLoad(() => (id ? api<any>(`/questions/${id}/`) : Promise.resolve(null)), [id]);
  const [s, setS] = useState<S>(() => (initial ? { ...fresh(), ...initial, subject: subject ? String(subject) : initial.subject } : { ...fresh(), subject: subject ? String(subject) : "" })), [status, setStatus] = useState("draft"), [errs, setErrs] = useState<string[]>([]), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<S | null>(null), [similar, setSimilar] = useState<any[]>([]), [cid, setCid] = useState<number | null>(id), [view, setView] = useState<"phone" | "computer">("phone");
  const key = `amani_qdraft_${id || "new"}`, loaded = useRef(false), accRef = useRef<HTMLTextAreaElement>(null);
  const up = (p: Partial<S>) => setS((x) => ({ ...x, ...p }));
  const fixPref = useAutofix(), fix = fixPref && s.language === "en";  // capitals and corrections only for English questions

  useEffect(() => {
    if (loaded.current || existing.loading) return;
    loaded.current = true;
    if (existing.data) { setS(fromApi(existing.data)); setStatus(existing.data.status); }
    if (onDraft) return;  // inside the exam builder the draft lives on the server, not on this device
    try { const d = localStorage.getItem(key); if (d) setDraft(JSON.parse(d)); } catch { /* ignore */ }
  }, [existing.loading, existing.data, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // QB-08: autosave the draft while typing (kept on this device until saved to the server).
  const dirty = useRef(false);
  useEffect(() => {
    if (!loaded.current) return;
    dirty.current = true;
    if (onDraft) { onDraft(s); return; }  // the builder debounces and stores it on the server
    const t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* full */ } }, 1500); return () => clearTimeout(t);
  }, [s, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // QB-12: warn about likely duplicates.
  useEffect(() => {
    const words = plain(s.prompt).split(" ").slice(0, 6).join(" ");
    if (!s.subject || words.length < 12) return setSimilar([]);
    const t = setTimeout(() => api<any[]>(`/questions/?subject=${s.subject}&q=${encodeURIComponent(words)}`).then((r) => setSimilar(r.filter((x) => x.id !== cid).slice(0, 3))).catch(() => {}), 900);
    return () => clearTimeout(t);
  }, [s.prompt, s.subject, cid]);

  const mySubjects = useMemo(() => {
    const all = subjects.data || [];
    if (admin || !assigned.data) return all;
    const ids = new Set(assigned.data.map((a) => a.subject));
    return all.filter((x) => ids.has(x.id));
  }, [subjects.data, assigned.data, admin]);

  const preview: Question = useMemo(() => {
    const b = build(s);
    const withIds = (l: any[]) => l.map((o: any) => ({ ...o, text: o.text }));
    const c: any = { ...b.content };
    for (const k of ["options", "left", "right", "items"]) if (c[k]) c[k] = withIds(c[k]);
    return { id: 0, type: s.qtype as any, prompt: s.prompt || "<p><i>Question text appears here</i></p>", marks: s.marks, content: c };
  }, [s]);
  const [pv, setPv] = useState<any>(undefined);

  async function save(then?: "submit"): Promise<any> {
    let saved: any = null;
    setBusy(true); setErrs([]); setMsg("");
    try {
      const body = build(s);
      const q = cid ? await api<any>(`/questions/${cid}/`, { method: "PATCH", body }) : await api<any>("/questions/", { body });
      setCid(q.id); setStatus(q.status); setS(fromApi(q)); localStorage.removeItem(key); setDraft(null);
      saved = q;
      if (then === "submit") { const r = await api<any>(`/questions/${q.id}/submit/`, { body: {} }); setStatus(r.status); saved = { ...q, status: r.status }; setMsg("Saved and approved. It is now available to the exam builder."); }
      else setMsg("Saved.");
    } catch (e: any) { setErrs(errorLines(e.data, e.message)); saved = null; }
    setBusy(false);
    return saved;
  }
  async function saveAndAdd() { const q = await save("submit"); if (q && onCreated) onCreated(q); }
  async function decide(what: "approve" | "reject") {
    setBusy(true);
    try { const r = await api<any>(`/questions/${cid}/${what}/`, { body: what === "reject" ? { reason: window.prompt("Reason (optional)") || "" } : {} }); setStatus(r.status); setMsg(what === "approve" ? "Approved." : "Returned to draft."); } catch (e: any) { setErrs(errorLines(e.data, e.message)); }
    setBusy(false);
  }

  if (subjects.loading || existing.loading || assigned.loading) return <Loading />;
  if (subjects.error || existing.error) return <ErrorNote error={subjects.error || existing.error} />;
  const lock = status === "archived";
  const listEditor = (key: "options" | "left" | "right" | "items", min: number, max: number, name: string, withCorrect?: boolean) => (
    <>
      {s[key].map((it, i) => (
        <ItemRow key={it.id} autofix={fix} it={it} canRemove={s[key].length > min}
          tag={key === "options" ? letters(i + 1) : key === "left" ? leftMark(s.mLeftStyle, i) : key === "right" ? rightMark(s.mRightStyle, i) : undefined}
          label={`${name} ${key === "options" ? letters(i + 1) : key === "left" ? leftMark(s.mLeftStyle, i).replace(/[()]/g, "") : key === "right" ? rightTag(s.mRightStyle, i) : i + 1}`}
          onChange={(n) => up({ [key]: s[key].map((x) => (x.id === it.id ? n : x)) } as any)}
          onRemove={() => up({ [key]: s[key].filter((x) => x.id !== it.id), correct: s.correct.filter((c) => c !== it.id) } as any)}
          extra={withCorrect ? (s.qtype === "mcq_single"
            ? <label className="switch" title="Correct answer"><input type="radio" name="correct" checked={s.correct[0] === it.id} onChange={() => up({ correct: [it.id] })} /> ✓</label>
            : <label className="switch" title="Correct answer"><input type="checkbox" checked={s.correct.includes(it.id)} onChange={(e) => up({ correct: e.target.checked ? [...s.correct, it.id] : s.correct.filter((c) => c !== it.id) })} /> ✓</label>) : key === "items" ? <span className="num">{i + 1}</span> : undefined} />
      ))}
      {s[key].length < max && <button type="button" className="btn" onClick={() => up({ [key]: [...s[key], ...blank(1)] } as any)}>+ Add {name.toLowerCase()}</button>}
    </>
  );

  return (
    <div className="qeditor" onKeyDownCapture={enterToNext}>
      <div className="row"><button className="btn" onClick={onClose}>{backLabel || "← Back to list"}</button><span className="pill">{cid ? `#${cid}` : "New"} · {status}</span></div>
      {draft && <div className="hint" role="status">An unsaved draft from this device was found. <button className="btn" onClick={() => { setS(draft); setDraft(null); }}>Restore it</button> <button className="btn" onClick={() => { localStorage.removeItem(key); setDraft(null); }}>Discard</button></div>}
      <p className="muted small">Tip: press <b>Enter</b> to jump to the next field, <b>Shift+Enter</b> for a new line (you can switch this off in Settings).</p>
      <AutofixSwitch language={s.language} />
      {lock && <p className="hint">This question is archived (it was used in an exam).</p>}
      <div className="card">
        <div className="grid2">
          <label className="field"><span>Subject</span><select className="input" value={s.subject} disabled={!!subject} onChange={(e) => up({ subject: e.target.value })}><option value="">Choose…</option>{mySubjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field"><span>Form</span><select className="input" value={s.form_level} onChange={(e) => up({ form_level: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Form {n}</option>)}</select></label>
          <label className="field"><span>Topic</span><input className="input" value={s.topic} onChange={(e) => up({ topic: e.target.value })} /></label>
          <label className="field"><span>Sub-topic</span><input className="input" value={s.subtopic} onChange={(e) => up({ subtopic: e.target.value })} /></label>
          <label className="field"><span>Difficulty</span><select className="input" value={s.difficulty} onChange={(e) => up({ difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
          <label className="field"><span>Marks</span><input className="input" type="number" min={0.5} step={0.5} value={s.marks} onChange={(e) => up({ marks: Number(e.target.value) })} /></label>
          <label className="field"><span>Language</span><select className="input" value={s.language} onChange={(e) => up({ language: e.target.value })}><option value="en">English</option><option value="sw">Kiswahili</option></select></label>
          <label className="field"><span>Question type</span><select className="input" value={s.qtype} disabled={!!cid} onChange={(e) => up({ qtype: e.target.value, correct: [] })}>{QTYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <label className="switch"><input type="checkbox" checked={s.practice_eligible} onChange={(e) => up({ practice_eligible: e.target.checked })} /> Practice eligible (students may use it in practice quizzes; never reserve upcoming exam questions)</label>
      </div>

      <h2>Question</h2>
      <RichEditor label="Question text" autofix={fix} value={s.prompt} onChange={(h) => up({ prompt: h })} />
      {similar.length > 0 && <div className="hint" role="status">⚠ Similar questions already exist: {similar.map((q) => <div key={q.id}>#{q.id} {plain(q.prompt).slice(0, 80)}</div>)}</div>}

      <h2>Answer</h2>
      {(s.qtype === "mcq_single" || s.qtype === "mcq_multi") && <><p className="muted small">{s.qtype === "mcq_single" ? "Tick the one correct option (2 or more options)." : "Tick every correct option (2 or more options)."}</p>{listEditor("options", 2, Infinity, "Option", true)}</>}
      {s.qtype === "true_false" && <div className="row2" role="radiogroup" aria-label="Correct answer">{[true, false].map((b) => <label key={String(b)} className={`opt center-text ${s.tf === b ? "on" : ""}`}><input type="radio" name="tf" checked={s.tf === b} onChange={() => up({ tf: b })} />{b ? "The statement is TRUE" : "The statement is FALSE"}</label>)}</div>}
      {s.qtype === "fill_blank" && (
        <div className="card">
          <label className="field"><span>Accepted answers (one per line; capital letters and extra spaces are ignored)</span><textarea ref={accRef} className="input" rows={3} value={s.accepted} onChange={(e) => up({ accepted: e.target.value })} /></label>
          <div className="row" style={{ marginBottom: ".5rem" }}><SymbolPad target={accRef} value={s.accepted} onChange={(v) => up({ accepted: v })} /><span className="muted small">Symbols such as π, °, ² are typed as plain characters. Students get a symbols button too.</span></div>
          <div className="grid2"><label className="field"><span>Numeric answer (optional)</span><input className="input" inputMode="decimal" value={s.numValue} onChange={(e) => up({ numValue: e.target.value })} /></label>
            <label className="field"><span>Allowed difference (±)</span><input className="input" inputMode="decimal" value={s.numTol} onChange={(e) => up({ numTol: e.target.value })} /></label></div>
        </div>
      )}
      {s.qtype === "fill_blank" && <FillSettings s={s} up={up} />}
      {s.qtype === "ordering" && <><p className="muted small">Write the items in the CORRECT order. Students see them shuffled. (2 or more items)</p>{listEditor("items", 2, Infinity, "Item")}</>}
      {s.qtype === "matching" && (
        <>
          <p className="muted small">Left items and the right items they match with. Pick the right match for each left item.</p>
          <h3>Column A (left side)</h3>{listEditor("left", 2, Infinity, "Left item")}
          <h3>Column B (right side)</h3>{listEditor("right", 2, Infinity, "Right item")}
          <h3>Correct matches</h3>
          {s.left.map((l, i) => (
            <div key={l.id} className="match-row"><span>{leftMark(s.mLeftStyle, i)} {plain(l.text) || l.alt_text || `Left ${i + 1}`}</span>
              <select className="input" aria-label={`Match for left item ${i + 1}`} value={s.pairs[l.id] || ""} onChange={(e) => up({ pairs: { ...s.pairs, [l.id]: e.target.value } })}>
                <option value="">Choose…</option>{s.right.map((r, j) => <option key={r.id} value={r.id}>{rightTag(s.mRightStyle, j)}. {plain(r.text) || r.alt_text || `Right ${j + 1}`}</option>)}</select></div>))}
          <MatchSettings s={s} up={up} />
        </>
      )}

      <h2>Explanation (shown after results are published)</h2>
      <RichEditor label="Explanation" autofix={fix} value={s.explanation} onChange={(h) => up({ explanation: h })} minRows={2} />

      <h2>Preview</h2>
      <div className="chips" role="group"><button type="button" className={`chip ${view === "phone" ? "on" : ""}`} aria-pressed={view === "phone"} onClick={() => setView("phone")}>📱 Phone</button><button type="button" className={`chip ${view === "computer" ? "on" : ""}`} aria-pressed={view === "computer"} onClick={() => setView("computer")}>💻 Computer</button></div>
      <div className="card" style={{ maxWidth: view === "phone" ? 360 : 760, margin: "0 auto .9rem" }}><QuestionView q={preview} value={pv} onChange={setPv} /></div>

      {errs.length > 0 && <div className="card error" role="alert">{errs.map((e, i) => <p key={i}>⚠ {e}</p>)}</div>}
      {msg && <p className="ok" role="status">✓ {msg}</p>}
      <div className="row" style={{ position: "sticky", bottom: 70, background: "var(--bg)", padding: ".5rem 0" }}>
        {onCreated ? <button className="btn primary big" disabled={busy || lock} onClick={saveAndAdd}>✓ Save and add to this exam</button> : <>
          <button className="btn" disabled={busy || lock} onClick={() => save()}>Save draft</button>
          <button className="btn primary" disabled={busy || lock} onClick={() => save("submit")}>Save and submit</button></>}
        {admin && cid && status === "submitted" && <><button className="btn primary" disabled={busy} onClick={() => decide("approve")}>Approve</button><button className="btn danger" disabled={busy} onClick={() => decide("reject")}>Send back</button></>}
      </div>
    </div>
  );
}
