"use client";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** Save / submit / schedule flow for an exam paper: toast, animated progress track, result panel and the action card. */

export type Action = "save" | "submit" | "schedule";
export type Run = { action: Action; step: number; status: "busy" | "ok" | "err"; lines?: string[]; detail?: string };

export const FLOW: Record<Action, { steps: string[]; okTitle: string; okText: string; errTitle: string }> = {
  save: { steps: ["Save paper", "Saved"], okTitle: "Paper saved", okText: "Your changes are safe.", errTitle: "Could not save the paper" },
  submit: { steps: ["Save paper", "Send to admin", "Submitted"], okTitle: "Submitted to admin", okText: "It now shows at the top of the administrators’ exam list.", errTitle: "Could not submit the paper" },
  schedule: { steps: ["Save paper", "Schedule", "Scheduled"], okTitle: "Exam scheduled", okText: "Students can now see it.", errTitle: "Could not schedule the exam" },
};

const Check = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path className="fx-tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Cross = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;

/* ------------------------------------------------------------------ toast */
type ToastData = { id: number; kind: "ok" | "err"; title: string; text?: string };
export function useToast() {
  const [t, setT] = useState<ToastData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hide = useCallback(() => { clearTimeout(timer.current); setT(null); }, []);
  const show = useCallback((kind: "ok" | "err", title: string, text?: string) => {
    clearTimeout(timer.current);
    setT({ id: Date.now(), kind, title, text });
    if (kind === "ok") timer.current = setTimeout(() => setT(null), 4500);   // errors stay until dismissed
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const toast: ReactNode = t && (
    <div key={t.id} className={`fx-toast ${t.kind}`} role={t.kind === "err" ? "alert" : "status"}>
      <span className="fx-toast-ico">{t.kind === "ok" ? <Check /> : <Cross />}</span>
      <div className="grow"><b>{t.title}</b>{t.text && <p>{t.text}</p>}</div>
      <button className="fx-x" aria-label="Dismiss message" onClick={hide}>✕</button>
    </div>
  );
  return { toast, show, hide };
}

/* ------------------------------------------------------------------ progress track */
function Track({ run }: { run: Run }) {
  const labels = FLOW[run.action].steps;
  return (
    <ol className="fx-track" aria-label="Progress">
      {labels.map((l, i) => {
        const done = run.status === "ok" || i < run.step, bad = run.status === "err" && i === run.step, active = !done && !bad && run.status === "busy" && i === run.step;
        return (
          <li key={l} className={`fx-node ${done ? "done" : bad ? "bad" : active ? "active" : ""}`} aria-current={active ? "step" : undefined}>
            <span className="fx-dot">{done ? <Check /> : bad ? <Cross /> : active ? <i className="fx-spin" /> : i + 1}</span>
            <span className="fx-lab">{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ the action card */
export function PaperActions(p: {
  admin: boolean; status: string; editable: boolean; dirty: boolean; count: number; marks: number; submittedAt?: string | null; submittedLabel?: string;
  checks: { ok: boolean; label: string }[]; run: Run | null; onRun: (a: Action) => void; onBack: () => void; onDismiss: () => void; onDone?: () => void;
}) {
  const { admin, run, dirty, count, checks } = p, busy = run?.status === "busy", ready = checks.every((c) => c.ok), draft = p.status === "draft";
  const primary: Action | null = !p.editable || !draft ? null : admin ? "schedule" : "submit";
  const resubmit = !admin && !!p.submittedAt && !dirty;
  const primaryLabel = admin ? "Schedule exam" : resubmit ? "Resubmit to admin" : "Submit to admin";
  return (
    <div className="card paper-actions fx-card" aria-live="polite">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>{admin ? "Save or schedule" : "Save or submit"}</h3>
        <span className="pill">{count} question{count === 1 ? "" : "s"} · {p.marks} marks</span>
      </div>
      <ul className="checks fx-checks">{checks.map((c, i) => <li key={c.label} className={c.ok ? "ok" : "todo"} style={{ animationDelay: `${i * 70}ms` }}><span className="fx-ci">{c.ok ? "✓" : "○"}</span> {c.label}</li>)}</ul>
      {dirty && !run && p.editable && <p className="fx-note">You have unsaved changes. {primary ? "They are saved automatically when you continue." : ""}</p>}
      {!admin && p.submittedAt && !run && <p className="muted small">{p.submittedLabel}</p>}

      {run && <Track run={run} />}

      {run?.status === "err" && (
        <div className="fx-result bad" role="alert">
          <div className="fx-badge"><Cross /></div>
          <div className="grow"><b>{FLOW[run.action].errTitle}</b>{run.lines?.map((l, i) => <p key={i}>{l}</p>)}</div>
          <div className="fx-btns"><button className="btn primary" onClick={() => p.onRun(run.action)}>Try again</button><button className="btn ghost" onClick={p.onDismiss}>Dismiss</button></div>
        </div>
      )}

      {run?.status === "ok" && run.action !== "save" && (
        <div className="fx-result good">
          <svg className="fx-ring" viewBox="0 0 52 52" aria-hidden><circle cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M15 27l8 8 14-16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="grow"><b>{FLOW[run.action].okTitle}</b><p>{run.detail || FLOW[run.action].okText}</p></div>
          <div className="fx-btns">{p.onDone && <button className="btn primary" onClick={p.onDone}>Back to exams</button>}<button className="btn" onClick={p.onDismiss}>Keep editing</button></div>
        </div>
      )}

      {run?.status === "ok" && run.action === "save" && <p className="ok fx-saved">✓ {run.detail || "Paper saved."}</p>}

      {!run && p.editable && (
        <>
          <div className="row fx-actions">
            <button className="btn" onClick={p.onBack}>← Back</button>
            <span className="grow" />
            <button className="btn" disabled={busy || !count || !dirty} onClick={() => p.onRun("save")}>{dirty ? (admin ? "Save" : "Save draft") : "Saved ✓"}</button>
            {primary && <button className="btn primary fx-go" disabled={busy || !count || (admin && !ready)} onClick={() => p.onRun(primary)}>{primaryLabel}</button>}
          </div>
          {admin && draft && !ready && count > 0 && <p className="muted small">To schedule, set the date, time and classes in the details at the top, press <b>Save changes</b>, then come back here. <button className="linkbtn" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Go to details ↑</button></p>}
        </>
      )}
    </div>
  );
}
