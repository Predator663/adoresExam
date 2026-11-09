"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { speechSupported } from "@/lib/speech";
import { nearHandle, snap } from "@/lib/stepper";

export const THEME_LIST = ["light", "dark", "high_contrast", "colour_blind", "soft", "mw3"] as const;

/** A size control that cannot change by accident. The old plain slider changed the text size whenever a finger touched the bar while
 *  scrolling (or while stopping a scroll), and every step re-laid out the page under the finger, so the size ran away.
 *   - Vertical swipes always scroll the page (CSS touch-action: pan-y); only a sideways drag moves the handle.
 *   - Only a touch that STARTS on the round handle counts; touching elsewhere on the bar does nothing.
 *   - While the handle is held the page does not change; the size is applied when the finger lets go.
 *   - The - and + buttons give one deliberate step each, for people who cannot use a slider. Keyboard and screen readers work as usual. */
function SizeControl({ label, value, min, max, step, show, less, more, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; less: string; more: string; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value), grab = useRef<"none" | "handle" | "bar">("none"), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const set = (v: number) => { draftRef.current = v; setDraft(v); };
  useEffect(() => { if (grab.current === "none") set(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v: number) => { clearTimeout(timer.current); if (Math.abs(v - value) > 1e-9) onCommit(v); };
  const nudge = (dir: 1 | -1) => { const v = snap(draftRef.current + dir * step, min, max, step); set(v); commit(v); };

  const down = (e: React.PointerEvent<HTMLInputElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    grab.current = nearHandle(e.clientX - r.left, r.width, draftRef.current, min, max) ? "handle" : "bar";
    const end = (ev: Event) => {
      window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
      const g = grab.current; grab.current = "none";
      if (g === "handle" && ev.type === "pointerup") commit(draftRef.current); else set(value);  // a cancelled touch (the page started scrolling) puts everything back
    };
    window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };
  return (
    <div className="a11y-size">
      <button type="button" className="btn a11y-step" aria-label={less} disabled={draft <= min} onClick={() => nudge(-1)}>−</button>
      <input type="range" min={min} max={max} step={step} value={draft} aria-label={label} aria-valuetext={show(draft)} onPointerDown={down}
        onChange={(e) => {
          if (grab.current === "bar") return;  // a stray touch on the bar (for example to stop a scroll): ignored, the handle stays where it was
          const v = snap(Number(e.target.value), min, max, step); set(v);
          if (grab.current === "none") { clearTimeout(timer.current); timer.current = setTimeout(() => commit(v), 450); }  // keyboard / screen reader
        }} />
      <button type="button" className="btn a11y-step" aria-label={more} disabled={draft >= max} onClick={() => nudge(1)}>+</button>
    </div>
  );
}

/** ACC-01/02/03/06: theme, text size (100-200%), dyslexia font, line spacing, read-aloud, reduce motion. */
export default function A11yPanel({ compact }: { compact?: boolean }) {
  const { user, savePrefs, t } = useSession();
  const a = user?.accessibility;
  const theme = user?.theme || (typeof document !== "undefined" ? document.documentElement.dataset.theme : "light") || "light";
  const hc = typeof document !== "undefined" ? document.documentElement.dataset.hc : "dark";
  return (
    <div className="a11y">
      <fieldset>
        <legend>{t("theme")}</legend>
        <div className="chips">
          {THEME_LIST.map((k) => (
            <label key={k} className={`chip ${theme === k ? "on" : ""}`}>
              <input type="radio" name="theme" checked={theme === k} onChange={() => savePrefs({ theme: k })} />
              {theme === k ? "✓ " : ""}{t(`theme_${k}`)}
            </label>
          ))}
        </div>
        {theme === "high_contrast" && (
          <div className="chips" role="group" aria-label={t("hc_variant")}>
            {(["dark", "light"] as const).map((v) => (
              <label key={v} className={`chip ${hc === v ? "on" : ""}`}>
                <input type="radio" name="hc" checked={hc === v} onChange={() => savePrefs({ hc: v })} />
                {hc === v ? "✓ " : ""}{t(v === "dark" ? "hc_yellow" : "hc_black")}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="field">
        <span>{t("text_size")}: {a?.text_size ?? 100}%</span>
        <SizeControl label={t("text_size")} value={a?.text_size ?? 100} min={100} max={200} step={10} show={(v) => `${v}%`}
          less={t("text_smaller")} more={t("text_larger")} onCommit={(v) => savePrefs({ text_size: v })} />
        <small className="muted">{t("size_hint")}</small>
        {(a?.text_size ?? 100) !== 100 && <button type="button" className="btn small" onClick={() => savePrefs({ text_size: 100 })}>↺ {t("text_reset")}</button>}
      </div>

      {!compact && (
        <div className="field">
          <span>{t("line_spacing")}: {(a?.line_spacing ?? 1.5).toFixed(1)}</span>
          <SizeControl label={t("line_spacing")} value={a?.line_spacing ?? 1.5} min={1} max={2.5} step={0.1} show={(v) => v.toFixed(1)}
            less={t("spacing_less")} more={t("spacing_more")} onCommit={(v) => savePrefs({ line_spacing: v })} />
        </div>
      )}

      <label className="switch"><input type="checkbox" checked={!!a?.dyslexia_font} onChange={(e) => savePrefs({ dyslexia_font: e.target.checked })} /> {t("dyslexia_font")}</label>
      <label className="switch"><input type="checkbox" checked={!!a?.reduce_motion} onChange={(e) => savePrefs({ reduce_motion: e.target.checked })} /> {t("reduce_motion")}</label>
      <label className="switch">
        <input type="checkbox" checked={!!a?.read_aloud} onChange={(e) => savePrefs({ read_aloud: e.target.checked })} /> {t("read_aloud")}
      </label>
      {a?.read_aloud && !speechSupported() && <p className="muted small">{t("read_aloud_unsupported")}</p>}
    </div>
  );
}
