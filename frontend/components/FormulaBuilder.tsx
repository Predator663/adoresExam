"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { chemHtml, fracHtml, mathSpan, renderMath, rootHtml } from "@/lib/mathHtml";
import { Modal } from "./ui";

/** The formula builder: pick what you want to write, type into boxes that are laid out like the formula itself, watch it appear
 *  at the top as you type, then tap Insert. A symbol row (+ − × ÷ = ± π ° ² …) types into whichever box has the cursor. */
type Kind = "frac" | "power" | "sub" | "root" | "chem" | "eq";
type Field = { k: string; label: string; ph: string; optional?: boolean };

const TILES: { kind: Kind; name: string; icon: string }[] = [
  { kind: "frac", name: "Fraction", icon: fracHtml("a", "b") },
  { kind: "power", name: "Power", icon: "x<sup>2</sup>" },
  { kind: "sub", name: "Subscript", icon: "x<sub>1</sub>" },
  { kind: "root", name: "Root", icon: rootHtml("x") },
  { kind: "chem", name: "Chemical", icon: "H<sub>2</sub>O" },
  { kind: "eq", name: "Equation", icon: "ax<sup>2</sup>+b" },
];
const FIELDS: Record<Kind, Field[]> = {
  frac: [{ k: "whole", label: "Whole number (optional)", ph: "2", optional: true }, { k: "a", label: "Top", ph: "3" }, { k: "b", label: "Bottom", ph: "4" }],
  power: [{ k: "base", label: "Number or letter", ph: "x" }, { k: "exp", label: "Power", ph: "2" }],
  sub: [{ k: "base", label: "Number or letter", ph: "x" }, { k: "low", label: "Small number below", ph: "1" }],
  root: [{ k: "index", label: "Root number (optional)", ph: "3", optional: true }, { k: "inside", label: "Inside the root", ph: "x+1" }],
  chem: [{ k: "chem", label: "Chemical formula", ph: "H2O" }],
  eq: [{ k: "eq", label: "Type your formula", ph: "x^2 + 3x - 5 = 0" }],
};
const HELP: Record<Kind, string> = {
  frac: "Type the top and the bottom. Add a whole number in front for a mixed number such as 2¾.",
  power: "Type the number or letter, then the power that sits above it, such as x and 2.",
  sub: "Type the number or letter, then the small number that sits below it, such as x and 1.",
  root: "Type what is inside the root. Add a root number for a cube root or higher.",
  chem: "Type numbers normally: H2O becomes H₂O. Use ^ for a charge, such as SO4^2-.",
  eq: "Type naturally. ^ raises (x^2), _ lowers (x_1), / makes a fraction ((a+1)/2) and sqrt( ) makes a root.",
};
const EXAMPLES: Record<Kind, Record<string, string>> = {
  frac: { whole: "2", a: "3", b: "4" }, power: { base: "x", exp: "2" }, sub: { base: "x", low: "1" }, root: { index: "", inside: "x+1" },
  chem: { chem: "Ca(OH)2" }, eq: { eq: "(-b +- sqrt(b^2 - 4ac))/(2a)" },
};
const COMPOUNDS = ["H2O", "CO2", "O2", "NaCl", "H2SO4", "NH3", "CH4", "SO4^2-", "NO3^-"];
const KEYS = ["+", "−", "×", "÷", "=", "±", "(", ")", "π", "°", "²", "³", "≤", "≥", "≠", "≈", "∞", "→"];
const SNIPPETS: [string, string][] = [["x²", "^"], ["x₁", "_"], ["a⁄b", "/"], ["√", "sqrt()"]];

/** What goes into the question, and whether enough has been typed yet. */
function build(kind: Kind, v: Record<string, string>): { html: string; src: string; ready: boolean } {
  const g = (k: string) => (v[`${kind}.${k}`] || "").trim();
  switch (kind) {
    case "frac": { const [w, a, b] = [g("whole"), g("a"), g("b")]; return { html: (w ? `<span class="mwhole">${renderMath(w)}</span>` : "") + fracHtml(renderMath(a), renderMath(b)), src: `${w} ${a}/${b}`.trim(), ready: !!(a && b) }; }
    case "power": return { html: renderMath(g("base")) + `<sup>${renderMath(g("exp"))}</sup>`, src: `${g("base")}^{${g("exp")}}`, ready: !!(g("base") && g("exp")) };
    case "sub": return { html: renderMath(g("base")) + `<sub>${renderMath(g("low"))}</sub>`, src: `${g("base")}_{${g("low")}}`, ready: !!(g("base") && g("low")) };
    case "root": return { html: rootHtml(renderMath(g("inside")), g("index") ? renderMath(g("index")) : ""), src: `root(${g("index")},${g("inside")})`, ready: !!g("inside") };
    case "chem": return { html: chemHtml(g("chem")), src: g("chem"), ready: !!g("chem") };
    default: return { html: renderMath(g("eq")), src: g("eq"), ready: !!g("eq") };
  }
}

export default function FormulaBuilder({ onInsert, onClose }: { onInsert: (html: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("frac"), [vals, setVals] = useState<Record<string, string>>({});
  const active = useRef<HTMLInputElement | null>(null), canvas = useRef<HTMLDivElement>(null);
  const fields = FIELDS[kind];
  const val = (k: string) => vals[`${kind}.${k}`] || "";
  const set = (k: string, x: string) => setVals((o) => ({ ...o, [`${kind}.${k}`]: x }));

  // preview: what she typed so far, with grey examples for the boxes still empty
  const { html, src, ready } = useMemo(() => build(kind, vals), [kind, vals]);
  const ghost = useMemo(() => {
    const filled = { ...vals };
    for (const f of fields) if (!f.optional && !(vals[`${kind}.${f.k}`] || "").trim()) filled[`${kind}.${f.k}`] = f.ph;
    return build(kind, filled).html;
  }, [kind, vals]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(() => canvas.current?.querySelector<HTMLInputElement>("input")?.focus(), 60); return () => clearTimeout(t); }, [kind]);

  function type(text: string, caretBack = 0) {  // put text where the cursor is in the box she was using
    const el = active.current || canvas.current?.querySelector<HTMLInputElement>("input");
    if (!el) return;
    const name = el.dataset.name || fields[0].k, a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    set(name, el.value.slice(0, a) + text + el.value.slice(b));
    active.current = el;
    setTimeout(() => { el.focus(); const p = a + text.length - caretBack; el.setSelectionRange(p, p); }, 0);
  }
  const box = (f: Field, cls = "") => (
    <label key={f.k} className={`fb-box ${cls}`}>
      <span className="fb-cap">{f.label}</span>
      <input className="fb-in" data-name={f.k} value={val(f.k)} placeholder={f.ph} aria-label={f.label} autoComplete="off" autoCapitalize="off" spellCheck={false}
        onFocus={(e) => { active.current = e.currentTarget; }} onChange={(e) => set(f.k, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (ready) { onInsert(mathSpan(html, src)); onClose(); } } }} />
    </label>
  );

  return (
    <Modal label="Formula builder" onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Formula builder</h2>
      <div className="fb-preview" aria-live="polite" aria-label="Preview">
        <div key={html || "empty"} className={`fb-pop math ${ready ? "" : "ghost"}`} dangerouslySetInnerHTML={{ __html: ready ? html : ghost }} />
      </div>

      <p className="muted small fb-q">What do you want to write?</p>
      <div className="fb-tiles" role="group" aria-label="Formula type">
        {TILES.map((t) => (
          <button key={t.kind} type="button" className={`fb-tile ${kind === t.kind ? "on" : ""}`} aria-pressed={kind === t.kind} onClick={() => setKind(t.kind)}>
            <span className="fb-ico math" aria-hidden dangerouslySetInnerHTML={{ __html: t.icon }} /><span>{t.name}</span>
          </button>
        ))}
      </div>

      <p className="muted small fb-help" key={`h${kind}`}>{HELP[kind]}</p>
      <div className={`fb-canvas fb-${kind}`} ref={canvas} key={kind}>
        {kind === "frac" && <>{box(fields[0], "fb-whole")}<div className="fb-stack">{box(fields[1])}<i className="fb-bar" aria-hidden />{box(fields[2])}</div></>}
        {kind === "power" && <>{box(fields[0])}{box(fields[1], "fb-up")}</>}
        {kind === "sub" && <>{box(fields[0])}{box(fields[1], "fb-down")}</>}
        {kind === "root" && <>{box(fields[0], "fb-up fb-index")}<span className="fb-rootsign" aria-hidden>√</span>{box(fields[1], "fb-under")}</>}
        {(kind === "chem" || kind === "eq") && box(fields[0], "fb-wide")}
      </div>

      {kind === "chem" && <div className="fb-chips" aria-label="Common compounds">{COMPOUNDS.map((c) => <button key={c} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => set("chem", c)} dangerouslySetInnerHTML={{ __html: chemHtml(c) }} />)}</div>}
      {kind === "eq" && <div className="fb-chips" aria-label="Shortcuts">{SNIPPETS.map(([l, s]) => <button key={s} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => type(s, s.endsWith(")") ? 1 : 0)}>{l} <small className="muted">{s}</small></button>)}</div>}

      <div className="fb-keys" role="group" aria-label="Symbols">
        {KEYS.map((k) => <button key={k} type="button" className="fb-key" aria-label={k} onMouseDown={(e) => e.preventDefault()} onClick={() => type(k)}>{k}</button>)}
      </div>

      <div className="row fb-actions">
        <button type="button" className="btn ghost" onClick={() => setVals((o) => { const n = { ...o }; for (const [k, x] of Object.entries(EXAMPLES[kind])) n[`${kind}.${k}`] = x; return n; })}>✨ Try an example</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn primary ${ready ? "fb-ready" : ""}`} disabled={!ready} onClick={() => { onInsert(mathSpan(html, src)); onClose(); }}>Insert</button>
      </div>
    </Modal>
  );
}
