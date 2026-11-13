"use client";
/* Small building blocks for the Parents / SMS screen: animated numbers, toasts, an in-page confirm dialog,
   a phone-bubble preview, an SMS length counter and a few status widgets. Nothing here talks to the server. */
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui";

const calm = () => typeof window === "undefined" || document.documentElement.classList.contains("reduce-motion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up (or down) to its new value. Jumps straight there when the person asked for less motion. */
export function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current; prev.current = target;
    if (calm() || from === target) { setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => { const p = Math.min(1, (t - t0) / ms); setV(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
export function Count({ n }: { n: number }) { return <>{useCountUp(n)}</>; }

export function Stat({ n, of, label, icon, tone }: { n: number; of?: number; label: string; icon?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={`stat sms-stat ${tone || ""}`}>
      {icon && <i aria-hidden>{icon}</i>}
      <b><Count n={n} />{of !== undefined && <small>/{of}</small>}</b><span>{label}</span>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- toasts */
export type Toast = { ok: (t: string) => void; err: (t: string) => void };
export function useToasts(): Toast & { node: ReactNode } {
  const [items, setItems] = useState<{ id: number; kind: "ok" | "err"; text: string }[]>([]);
  const n = useRef(0);
  const push = useCallback((kind: "ok" | "err", text: string) => {
    const id = ++n.current;
    setItems((a) => [...a.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((a) => a.filter((x) => x.id !== id)), kind === "err" ? 8000 : 4500);
  }, []);
  const node = (
    <div className="sms-toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role={t.kind === "err" ? "alert" : "status"} className={`sms-toast ${t.kind}`}>
          <span className="sms-toast-ic" aria-hidden>{t.kind === "ok" ? "✓" : "!"}</span><span className="grow">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setItems((a) => a.filter((x) => x.id !== t.id))}>✕</button>
        </div>
      ))}
    </div>
  );
  return { ok: (t) => push("ok", t), err: (t) => push("err", t), node };
}

/* ----------------------------------------------------------------------------------------------- confirm dialog */
export type Ask = (o: { title: string; body?: ReactNode; yes?: string; danger?: boolean }) => Promise<boolean>;
export function useConfirm() {
  const [st, setSt] = useState<{ title: string; body?: ReactNode; yes: string; danger?: boolean; res: (v: boolean) => void } | null>(null);
  const ask: Ask = useCallback((o) => new Promise<boolean>((res) => setSt({ ...o, yes: o.yes || "Yes, continue", res })), []);
  const close = (v: boolean) => { st?.res(v); setSt(null); };
  const node = st && (
    <Modal label={st.title} onClose={() => close(false)}>
      <h2>{st.title}</h2>
      {st.body && <div className="sms-confirm-body">{st.body}</div>}
      <div className="row"><button className={`btn ${st.danger ? "danger" : "primary"} grow`} onClick={() => close(true)}>{st.yes}</button><button className="btn" onClick={() => close(false)}>Cancel</button></div>
    </Modal>
  );
  return { ask, node };
}

/* ----------------------------------------------------------------------------------------------- SMS length */
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXT = "^{}\\[~]|€";
/** How many SMS a text needs. Plain letters: 160 (153 each when joined). Any other character (emoji, curly quotes): 70 (67 joined). */
export function smsParts(text: string) {
  const chars = [...text];
  const unicode = chars.some((c) => !GSM.includes(c) && !EXT.includes(c));
  const len = unicode ? chars.length : chars.reduce((n, c) => n + (EXT.includes(c) ? 2 : 1), 0);
  const [one, many] = unicode ? [70, 67] : [160, 153];
  return { len, unicode, parts: len === 0 ? 0 : len <= one ? 1 : Math.ceil(len / many), perPart: one };
}

/** The text as it will look on the parent's phone. */
export function Bubble({ text, parts, from = "School" }: { text: string; parts?: number; from?: string }) {
  return (
    <figure className="sms-phone" aria-label="Preview of the message on the parent's phone">
      <figcaption>{from}</figcaption>
      <div className="sms-bubble">{text}</div>
      <div className="sms-meta">{parts ? `${parts} SMS` : "Preview"} · {[...text].length} characters</div>
    </figure>
  );
}

/* ----------------------------------------------------------------------------------------------- small widgets */
export function Avatar({ name }: { name: string }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return <span className="sms-av" style={{ background: `hsl(${h} 42% 36%)` }} aria-hidden>{ini}</span>;
}
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return <div className="sms-skel" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} style={{ animationDelay: `${i * 70}ms` }}><i /><i /><i /></div>)}</div>;
}
export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="card sms-empty"><div className="sms-empty-ic" aria-hidden>{icon}</div><h3>{title}</h3><div className="muted">{children}</div></div>;
}
export const STATUS_ICON: Record<string, string> = { queued: "⏳", sending: "📤", sent: "✓", delivered: "✓✓", failed: "✗", cancelled: "⊘" };
export const StatusPill = ({ s }: { s: string }) => <span className={`pill st-${s} sms-st`}>{STATUS_ICON[s]} {s}</span>;

/** Sent / waiting / failed as one coloured bar. */
export function Dist({ sent, waiting, failed }: { sent: number; waiting: number; failed: number }) {
  const total = sent + waiting + failed;
  if (!total) return null;
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="sms-dist" role="img" aria-label={`${sent} sent, ${waiting} waiting, ${failed} failed`}>
        <i className="g" style={{ width: w(sent) }} /><i className="w" style={{ width: w(waiting) }} /><i className="r" style={{ width: w(failed) }} />
      </div>
      <div className="sms-legend"><span><i className="g" />Sent {sent}</span><span><i className="w" />Waiting {waiting}</span><span><i className="r" />Failed {failed}</span></div>
    </div>
  );
}

export function fmtDur(sec: number) {
  if (sec < 60) return "under a minute";
  const m = Math.round(sec / 60);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `about ${h} h${r ? ` ${r} min` : ""}`;
}

export function useCopy(toast: Toast) {
  const [done, setDone] = useState("");
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setDone(key); toast.ok("Copied."); setTimeout(() => setDone(""), 2000); }).catch(() => toast.err("Could not copy. Select the text and copy it by hand."));
  };
  return { copy, done };
}

/* Saved wording, kept in this browser only. */
const KEY = "sms_note_templates";
export const loadTemplates = (): string[] => { try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, 8) : []; } catch { return []; } };
export const saveTemplates = (a: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(0, 8))); } catch { /* private window: nothing to keep */ } };
