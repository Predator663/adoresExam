"use client";
import { applyAutofix, undoAutofix } from "@/lib/autocorrect";
import { useEffect, useRef, useState } from "react";
import { api, API } from "@/lib/api";
import { Modal } from "./ui";
import FormulaBuilder from "./FormulaBuilder";
import { SYMBOLS } from "./SymbolPad";

/** QB-05: bold, italic, underline, lists, superscript/subscript, special characters, formulas and chemical formulas, images. */
export async function uploadImage(file: File, alt: string): Promise<{ url: string; alt_text: string }> {
  const fd = new FormData();
  fd.append("image", file); fd.append("alt_text", alt);
  return api("/question-images/", { body: fd });
}

const toEditor = (html: string) => html.split('src="/media').join(`src="${API}/media`);
const fromEditor = (html: string) => html.split(`src="${API}/media`).join('src="/media');

function ImageDialog({ onInsert, onClose }: { onInsert: (html: string) => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null), [alt, setAlt] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr("");
    try { const r = await uploadImage(file!, alt); onInsert(`<img src="${r.url}" alt="${alt.replace(/"/g, "&quot;")}">`); onClose(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal label="Add image" onClose={onClose}>
      <h2>Add an image</h2>
      <label className="field"><span>Photo or picture (camera, gallery or computer)</span><input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
      <label className="field"><span>Short description for students who cannot see it (required)</span><input className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} /></label>
      {err && <p className="no" role="alert">⚠ {err}</p>}
      <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!file || !alt.trim() || busy} onClick={go}>{busy ? "Uploading…" : "Insert"}</button></div>
    </Modal>
  );
}

/** An editor with only "<br>" or empty tags in it has no real content. */
const isEmptyHtml = (h: string) => !/<(img|sup|sub|span)\b/i.test(h) && h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";

/** `compact` = the small version used for one answer option, matching item or ordering item: one line, only superscript, subscript,
 *  symbols and formulas (no lists or pictures; a picture has its own button on the answer row). */
export default function RichEditor({ value, onChange, label, minRows = 4, compact = false, autofix = false }: { value: string; onChange: (html: string) => void; label: string; minRows?: number; compact?: boolean;
  /** English auto-capitalisation and auto-correction while typing (see lib/autocorrect.ts). */ autofix?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), saved = useRef<Range | null>(null), last = useRef<string>("");
  const [dlg, setDlg] = useState<"" | "formula" | "image" | "symbols">("");

  useEffect(() => { if (ref.current && value !== last.current) { ref.current.innerHTML = toEditor(value || ""); last.current = value || ""; } }, [value]);
  useEffect(() => {  // a native listener: React's own onBeforeInput is not the browser's beforeinput event
    const el = ref.current;
    if (!el || !autofix) return;
    const h = (e: Event) => applyAutofix(e as InputEvent, el, { capStart: !compact });
    el.addEventListener("beforeinput", h);
    return () => el.removeEventListener("beforeinput", h);
  }, [autofix, compact]);
  const emit = () => { const raw = fromEditor(ref.current?.innerHTML || ""), h = compact && isEmptyHtml(raw) ? "" : raw; last.current = h; onChange(h); };
  const remember = () => { const s = getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { ref.current?.focus(); const s = getSelection(); if (s && saved.current) { s.removeAllRanges(); s.addRange(saved.current); } };
  const cmd = (c: string) => { restore(); document.execCommand(c); emit(); };
  const insert = (html: string) => { restore(); document.execCommand("insertHTML", false, html); emit(); };
  const Btn = ({ c, children, title }: { c: string; children: React.ReactNode; title: string }) => (
    <button type="button" className="btn icon" title={title} aria-label={title} onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={() => cmd(c)}>{children}</button>);

  return (
    <div className={compact ? "grow" : "card"} style={compact ? { minWidth: 0 } : { padding: ".6rem" }}>
      <div className="row" role="toolbar" aria-label={`${label} formatting`}>
        {!compact && <><Btn c="bold" title="Bold"><b>B</b></Btn><Btn c="italic" title="Italic"><i>I</i></Btn><Btn c="underline" title="Underline"><u>U</u></Btn>
        <Btn c="insertUnorderedList" title="Bulleted list">•≡</Btn><Btn c="insertOrderedList" title="Numbered list">1≡</Btn></>}
        <Btn c="superscript" title="Superscript">x²</Btn><Btn c="subscript" title="Subscript">x₂</Btn>
        <button type="button" className="btn" onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={() => setDlg("symbols")}>Ω Symbols</button>
        <button type="button" className="btn" onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={() => setDlg("formula")}>∑ Formula</button>
        {!compact && <button type="button" className="btn" onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={() => setDlg("image")}>🖼 Image</button>}
      </div>
      <div ref={ref} className="input rich" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
        style={{ minHeight: `${compact ? 2.4 : minRows * 1.6}rem`, marginTop: ".5rem" }} onInput={emit}
        onKeyDown={(e) => {
          if (autofix && e.key === "Backspace" && undoAutofix()) { e.preventDefault(); emit(); return; }  // undo the last automatic change
          if (compact && e.key === "Enter" && !e.shiftKey) e.preventDefault();
        }} onBlur={() => { remember(); emit(); }}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} />
      {dlg === "formula" && <FormulaBuilder onInsert={insert} onClose={() => setDlg("")} />}
      {dlg === "image" && <ImageDialog onInsert={insert} onClose={() => setDlg("")} />}
      {dlg === "symbols" && (
        <Modal label="Symbols" onClose={() => setDlg("")}>
          <h2>Symbols</h2>
          <div className="chips">{SYMBOLS.map((s) => <button type="button" key={s} className="btn icon" aria-label={s} onClick={() => { insert(s); setDlg(""); }}>{s}</button>)}</div>
          <button type="button" className="btn" onClick={() => setDlg("")}>Close</button>
        </Modal>
      )}
    </div>
  );
}
