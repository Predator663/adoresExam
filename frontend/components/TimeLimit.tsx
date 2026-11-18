"use client";
import "./time-limit.css";
import { clampSecs, fmtSecs, MAX_SECONDS, MIN_SECONDS } from "@/lib/timing";

const PRESETS = [30, 60, 90, 120, 180, 300];

/** The time a student gets for ONE question. `value` null = not chosen: the suggested time for this question is used (and shown). */
export default function TimeLimit({ value, suggested, onChange, compact, label = "Time limit for this question" }: {
  value: number | null; suggested: number; onChange: (n: number | null) => void; compact?: boolean; label?: string;
}) {
  const shown = value ?? suggested, bad = value != null && (value < MIN_SECONDS || value > MAX_SECONDS);
  const set = (raw: string) => { if (raw === "") return onChange(null); const n = Math.round(Number(raw)); if (Number.isFinite(n)) onChange(n); };
  const step = (d: number) => onChange(clampSecs(shown + d));
  const input = (
    <span className={`tl-box ${bad ? "bad" : ""}`}>
      <button type="button" className="tl-step" aria-label="10 seconds less" onClick={() => step(-10)}>−</button>
      <input className="tl-in" type="number" inputMode="numeric" min={MIN_SECONDS} max={MAX_SECONDS} step={5} value={shown} aria-label={`${label} (seconds)`} aria-invalid={bad}
        onChange={(e) => set(e.target.value)} onBlur={() => { if (value != null && !bad) onChange(value); }} />
      <span className="tl-unit" aria-hidden>s</span>
      <button type="button" className="tl-step" aria-label="10 seconds more" onClick={() => step(10)}>+</button>
    </span>
  );
  if (compact) return <span className="tl tl-compact" title={fmtSecs(shown)}>⏱ {input}</span>;
  return (
    <div className="tl">
      <span className="tl-label">⏱ {label}</span>
      <div className="tl-row">
        {input}
        <span className="tl-human" aria-live="polite">{bad ? `Between ${MIN_SECONDS} s and ${MAX_SECONDS / 60} min` : fmtSecs(shown)}{value == null && <em> · suggested</em>}</span>
      </div>
      <div className="tl-chips" role="group" aria-label="Quick choices">
        {PRESETS.map((p) => <button type="button" key={p} className={`tl-chip ${shown === p ? "on" : ""}`} aria-pressed={shown === p} onClick={() => onChange(p)}>{fmtSecs(p)}</button>)}
        {value != null && value !== suggested && <button type="button" className="tl-chip auto" onClick={() => onChange(null)}>↺ Suggested ({fmtSecs(suggested)})</button>}
      </div>
      <p className="tl-note">When the time runs out the student moves on automatically, with whatever she has answered.</p>
    </div>
  );
}
