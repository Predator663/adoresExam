"use client";
import "./time-limit.css";
import { clampSecs, fmtSecs, MAX_SECONDS, MIN_SECONDS } from "@/lib/timing";

const PRESETS = [30, 60, 90, 120, 180, 300];

/** The time a student gets for ONE question. OFF by default (`value` null = no limit). Switching it on starts from the suggested time. */
export default function TimeLimit({ value, suggested, onChange, compact, label = "Time limit" }: {
  value: number | null; suggested: number; onChange: (n: number | null) => void; compact?: boolean; label?: string;
}) {
  const on = value != null, bad = on && (value! < MIN_SECONDS || value! > MAX_SECONDS);
  const set = (raw: string) => { if (raw === "") return onChange(suggested); const n = Math.round(Number(raw)); if (Number.isFinite(n)) onChange(n); };
  const step = (d: number) => onChange(clampSecs((value ?? suggested) + d));
  const toggle = (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`tl-sw ${on ? "on" : ""}`} onClick={() => onChange(on ? null : suggested)}>
      <span className="tl-knob" />
    </button>
  );
  const input = on && (
    <span className={`tl-box ${bad ? "bad" : ""}`}>
      <button type="button" className="tl-step" aria-label="10 seconds less" onClick={() => step(-10)}>−</button>
      <input className="tl-in" type="number" inputMode="numeric" min={MIN_SECONDS} max={MAX_SECONDS} step={5} value={value!} aria-label={`${label} (seconds)`} aria-invalid={bad}
        onChange={(e) => set(e.target.value)} />
      <span className="tl-unit" aria-hidden>s</span>
      <button type="button" className="tl-step" aria-label="10 seconds more" onClick={() => step(10)}>+</button>
    </span>
  );
  if (compact) return <span className="tl tl-compact">⏱ {toggle}{input}{!on && <span className="muted small">Off</span>}</span>;
  return (
    <div className="tl">
      <div className="tl-head">
        {toggle}
        <span className="tl-label">⏱ {label} <em>{on ? "On" : "Off"}</em></span>
      </div>
      {on && (
        <>
          <div className="tl-row">
            {input}
            <span className="tl-human" aria-live="polite">{bad ? `Between ${MIN_SECONDS} s and ${MAX_SECONDS / 60} min` : fmtSecs(value!)}</span>
          </div>
          <div className="tl-chips" role="group" aria-label="Quick choices">
            {PRESETS.map((p) => <button type="button" key={p} className={`tl-chip ${value === p ? "on" : ""}`} aria-pressed={value === p} onClick={() => onChange(p)}>{fmtSecs(p)}</button>)}
            {value !== suggested && <button type="button" className="tl-chip auto" onClick={() => onChange(suggested)}>↺ Suggested ({fmtSecs(suggested)})</button>}
          </div>
          <p className="tl-note">When the time runs out the student moves on automatically, with whatever she has answered.</p>
        </>
      )}
      {!on && <p className="tl-note">No time limit: the student can take as long as the exam allows.</p>}
    </div>
  );
}
