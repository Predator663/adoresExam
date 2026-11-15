"use client";
/* Building blocks of the Settings page: a setting row, switch, stepper, segmented choice, slider, section card and the
   floating save bar. Pure presentation: no data is loaded here. */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Icon from "./Icon";
import "./settings.css";

export function Section({ icon, title, hint, children, h = 160, i = 0 }: { icon: string; title: string; hint?: string; children: ReactNode; h?: number; i?: number }) {
  return (
    <section className="st-card" style={{ "--i": i, "--h": h } as CSSProperties}>
      <header><span className="st-ic"><Icon n={icon} size={20} /></span><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></header>
      <div className="st-rows">{children}</div>
    </section>
  );
}

/** One setting: its name and explanation on the left, the control on the right (below on a phone). */
export function Row({ title, hint, children, stack, changed }: { title: string; hint?: ReactNode; children: ReactNode; stack?: boolean; changed?: boolean }) {
  return (
    <div className={`st-row ${stack ? "stack" : ""} ${changed ? "changed" : ""}`}>
      <div className="st-row-t"><b>{title}</b>{hint && <small>{hint}</small>}</div>
      <div className="st-row-c">{children}</div>
    </div>
  );
}

export const Switch = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} className={`st-switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i><svg viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i></button>
);

export function Stepper({ value, onChange, min, max, step = 1, unit, presets, label }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number; unit?: string; presets?: number[]; label: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  return (
    <div className="st-stepper-wrap">
      <div className="st-stepper" role="group" aria-label={label}>
        <button type="button" aria-label="Less" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
        <input inputMode="numeric" aria-label={label} value={txt} onChange={(e) => { setTxt(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(clamp(n)); }} onBlur={() => setTxt(String(value))} />
        <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
        {unit && <span className="st-unit">{unit}</span>}
      </div>
      {presets && <div className="st-presets">{presets.map((p) => <button key={p} type="button" className={p === value ? "on" : ""} onClick={() => onChange(p)}>{p}</button>)}</div>}
    </div>
  );
}

export function Seg<T extends string | number>({ value, onChange, opts, label }: { value: T; onChange: (v: T) => void; opts: [T, string][]; label: string }) {
  const k = Math.max(0, opts.findIndex((o) => o[0] === value));
  return (
    <div className="st-seg" role="radiogroup" aria-label={label} style={{ "--n": opts.length, "--k": k } as CSSProperties}>
      <i aria-hidden />
      {opts.map(([v, t]) => <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

export function Slider({ value, onChange, min, max, unit, label, marks }: { value: number; onChange: (n: number) => void; min: number; max: number; unit: string; label: string; marks?: [number, string][] }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="st-slider" style={{ "--p": `${pct}%` } as CSSProperties}>
      <output><b>{value}</b> {unit}</output>
      <input type="range" min={min} max={max} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      {marks && <div className="st-marks">{marks.map(([n, t]) => <button key={n} type="button" onClick={() => onChange(n)}>{t}</button>)}</div>}
    </div>
  );
}

/** Appears from the bottom as soon as something is edited; the one place that saves. */
export function SaveBar({ dirty, count, busy, errors, saved, onSave, onDiscard }: { dirty: boolean; count: number; busy: boolean; errors: string[]; saved: string; onSave: () => void; onDiscard: () => void }) {
  return (
    <div className={`st-savebar ${dirty || errors.length || saved ? "show" : ""} ${errors.length ? "bad" : ""}`} role="region" aria-label="Save changes">
      <div className="st-savebar-in">
        {errors.length > 0 ? <ul role="alert">{errors.map((e, i) => <li key={i}>⚠ {e}</li>)}</ul>
          : dirty ? <span className="st-dirty"><i aria-hidden />{count} unsaved change{count === 1 ? "" : "s"}</span>
          : <span className="st-saved" role="status"><svg viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{saved}</span>}
        {(dirty || errors.length > 0) && <span className="st-savebar-b"><button type="button" className="btn" disabled={busy} onClick={onDiscard}>Discard</button><button type="button" className="btn primary" disabled={busy || !dirty} onClick={onSave}>{busy ? <><i className="spinner" aria-hidden /> Saving…</> : "Save changes"}</button></span>}
      </div>
    </div>
  );
}

export const THEME_LOOK: Record<string, { name: string; bg: string; surface: string; text: string; primary: string }> = {
  light: { name: "Light", bg: "#e6ece8", surface: "#f6f8f6", text: "#14201b", primary: "#0b6b4f" },
  dark: { name: "Dark", bg: "#0f1513", surface: "#18201d", text: "#e9f1ed", primary: "#5fd4a5" },
  high_contrast: { name: "High contrast", bg: "#000", surface: "#000", text: "#ff0", primary: "#ff0" },
  colour_blind: { name: "Colour-blind friendly", bg: "#ececec", surface: "#f6f6f6", text: "#111", primary: "#0072b2" },
  soft: { name: "Soft", bg: "#ece3d2", surface: "#f6efe0", text: "#3a3226", primary: "#47664e" },
  mw3: { name: "MW3", bg: "#0a0d0b", surface: "#121713", text: "#e9eee7", primary: "#ffb400" },
};

export function ThemePicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <div className="st-themes" role="radiogroup" aria-label="Default theme">
      {Object.entries(THEME_LOOK).map(([k, t]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          <span className="st-swatch" style={{ background: t.bg }} aria-hidden><i style={{ background: t.surface, borderColor: t.text }}><b style={{ background: t.primary }} /><b style={{ background: t.text, opacity: .5 }} /></i></span>
          <small>{t.name}</small><em aria-hidden><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></em>
        </button>
      ))}
    </div>
  );
}
