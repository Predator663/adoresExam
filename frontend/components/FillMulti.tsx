"use client";
/* Fill in the blanks (several): a passage with blanks, answered by typing, or by dragging words from a word bank.
   A word can be dragged with a finger or mouse, or tapped (tap the word, then tap the blank), or chosen with the keyboard.
   Every move makes a small sound and the word snaps into place. Nothing here knows the right answers. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RichHtml } from "./Rich";
import { sfx } from "@/lib/sfx";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";
import "./fill-multi.css";

type Word = { id: string; text: string };
const reduced = () => document.documentElement.classList.contains("reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The same order every time for one question, so the bank does not jump about while she answers. */
function seeded(list: Word[], seed: number): Word[] {
  const a = [...list];
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) { x = (x * 1664525 + 1013904223) >>> 0; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export default function FillMulti({ q, value, onChange, disabled }: { q: Question; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const { t } = useSession();
  const c = q.content || {}, blanks: { id: string }[] = c.blanks || [], bankMode = c.mode === "bank";
  const val: Record<string, string> = value && typeof value === "object" ? value : {};
  const bank: Word[] = useMemo(() => (c.bank_shuffled ? c.bank || [] : seeded(c.bank || [], q.id || 1)), [c.bank, c.bank_shuffled, q.id]);
  const wordText = (id: string) => bank.find((w) => w.id === id)?.text || "";
  const html = useMemo(() => (q.prompt || "").replace(/\[\[(\d+)\]\]/g, '<span class="fm-slot" data-b="$1"></span>'), [q.prompt]);

  // One element that never changes while the text is the same: React must not rewrite the passage's HTML, because the blanks are drawn inside it.
  const passage = useMemo(() => <RichHtml html={html} className="prompt fm-text" />, [html]);
  // the empty <span>s in the passage are where the blanks are drawn (portals keep the passage's own HTML intact)
  const wrap = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Record<string, HTMLElement>>({});
  useLayoutEffect(() => {
    const m: Record<string, HTMLElement> = {};
    wrap.current?.querySelectorAll<HTMLElement>(".fm-slot").forEach((el) => { m[el.dataset.b || ""] = el; });
    setSlots(m);
  }, [html]);

  const [sel, setSel] = useState<string | null>(null);        // a word chosen by tap, waiting for a blank
  const [over, setOver] = useState<string | null>(null);      // the blank under the dragged word
  const [dragging, setDragging] = useState<string | null>(null);
  const [pop, setPop] = useState<string | null>(null);        // the blank a word just snapped into
  const [said, setSaid] = useState("");
  const drag = useRef<{ word: string; from: string | null; el: HTMLElement; x0: number; y0: number; moved: boolean; ghost?: HTMLElement; over: string | null; tx: number; ty: number } | null>(null);
  const suppress = useRef(false);   // the click that follows a real drag must not also count as a tap
  const usedBy = (w: string) => blanks.find((b) => val[b.id] === w)?.id || null;
  const filled = blanks.filter((b) => (val[b.id] || "").trim() !== "").length;
  const done = blanks.length > 0 && filled === blanks.length;
  useEffect(() => { if (!pop) return; const x = setTimeout(() => setPop(null), 520); return () => clearTimeout(x); }, [pop]);

  const set = (next: Record<string, string>) => onChange(next);
  function place(word: string, to: string, from: string | null) {
    const next = { ...val };
    const there = next[to];
    for (const k of Object.keys(next)) if (next[k] === word) delete next[k];  // a word sits in one blank only
    if (from && there && there !== word) next[from] = there;                   // dragged from another blank onto a filled one: swap
    next[to] = word;
    set(next); setSel(null); setPop(to);
    const n = blanks.filter((b) => (next[b.id] || "").trim() !== "").length;
    (n === blanks.length && filled < blanks.length ? sfx.done : sfx.snap)();
    setSaid(`${wordText(word)} placed in blank ${blanks.findIndex((b) => b.id === to) + 1}. ${n} of ${blanks.length} filled.`);
  }
  function release(from: string) {
    const next = { ...val }; const w = next[from]; delete next[from];
    set(next); setSel(null); sfx.back();
    setSaid(`${wordText(w)} returned to the word bank.`);
  }
  const boxAt = (x: number, y: number) => {
    for (const el of document.elementsFromPoint(x, y)) { const b = (el as HTMLElement).closest?.("[data-box]") as HTMLElement | null; if (b && wrap.current?.contains(b)) return b.dataset.box || null; }
    return null;
  };

  function down(e: React.PointerEvent<HTMLElement>, word: string, from: string | null) {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { word, from, el: e.currentTarget, x0: e.clientX, y0: e.clientY, moved: false, over: null, tx: 0, ty: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 7) return;
      d.moved = true;
      const r = d.el.getBoundingClientRect(), g = d.el.cloneNode(true) as HTMLElement;
      g.classList.add("fm-ghost"); g.removeAttribute("id");
      Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      document.body.appendChild(g); d.ghost = g;
      setDragging(d.word); setSel(null); sfx.pick();
    }
    d.tx = dx; d.ty = dy;
    if (d.ghost) d.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.08) rotate(-3deg)`;
    const b = boxAt(e.clientX, e.clientY);
    if (b !== d.over) { d.over = b; setOver(b); if (b) sfx.tick(); }
  }
  function up(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current; drag.current = null; if (!d) return;
    d.el.releasePointerCapture?.(e.pointerId);
    const end = () => { d.ghost?.remove(); setDragging(null); setOver(null); };
    if (!d.moved) {  // a tap, not a drag (a tap on a blank is handled by its click)
      if (!d.from) setSel((s) => { const on = s !== d.word; if (on) sfx.pick(); return on ? d.word : null; });
      return;
    }
    suppress.current = true; setTimeout(() => { suppress.current = false; }, 0);
    const target = boxAt(e.clientX, e.clientY);
    if (target && d.ghost) {
      const to = slots[target]?.querySelector<HTMLElement>("[data-box]")?.getBoundingClientRect(), g = d.ghost.getBoundingClientRect();
      if (to && !reduced()) {  // fly the last few pixels into the blank, then settle
        const dx = d.tx + (to.left + to.width / 2 - (g.left + g.width / 2)), dy = d.ty + (to.top + to.height / 2 - (g.top + g.height / 2));
        d.ghost.style.transition = "transform .14s cubic-bezier(.2,.9,.3,1.2), opacity .14s";
        d.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1)`; d.ghost.style.opacity = "0.6";
        setTimeout(() => { place(d.word, target, d.from); end(); }, 140);
      } else { place(d.word, target, d.from); end(); }
    } else if (d.from) { release(d.from); end(); }           // dragged out of a blank and dropped elsewhere: back to the bank
    else {                                                    // missed: the word glides home
      if (d.ghost && !reduced()) { d.ghost.style.transition = "transform .22s cubic-bezier(.2,.9,.3,1), opacity .22s"; d.ghost.style.transform = "translate(0,0) scale(1)"; d.ghost.style.opacity = "0"; setTimeout(end, 220); sfx.back(); }
      else end();
    }
  }
  useEffect(() => () => { document.querySelectorAll(".fm-ghost").forEach((g) => g.remove()); }, []);
  // keyboard and screen readers (a "click" with no pointer): same as a tap
  const kb = (fn: () => void) => (e: React.MouseEvent) => { if (e.detail === 0) { e.preventDefault(); fn(); } };
  function tapWord(w: string) { setSel((s) => { const on = s !== w; if (on) sfx.pick(); return on ? w : null; }); }
  function tapBox(id: string) {
    if (disabled) return;
    if (sel) place(sel, id, null);
    else if (val[id]) release(id);
  }

  const width = ({ short: 6, medium: 9, long: 14 } as Record<string, number>)[c.width || "medium"] || 9;
  const num = (id: string) => blanks.findIndex((b) => b.id === id) + 1;
  return (
    <div className={`fm ${bankMode ? "bank" : "type"} ${done ? "done" : ""} ${dragging || sel ? "armed" : ""}`} ref={wrap}>
      {passage}
      {blanks.map((b) => slots[b.id] && createPortal(
        bankMode ? (
          <button type="button" data-box={b.id} disabled={disabled && !val[b.id]}
            className={`fm-box ${val[b.id] ? "filled" : ""} ${over === b.id ? "over" : ""} ${pop === b.id ? "pop" : ""} ${dragging && drag.current?.from === b.id ? "lifting" : ""}`}
            style={{ minWidth: `${Math.min(width, 9)}ch` }}
            aria-label={val[b.id] ? `${t("fm_blank")} ${num(b.id)}: ${wordText(val[b.id])}. ${disabled ? "" : t("fm_remove")}` : `${t("fm_blank")} ${num(b.id)}: ${t("fm_empty")}`}
            onPointerDown={val[b.id] ? (e) => down(e, val[b.id], b.id) : undefined} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onClick={() => { if (suppress.current) { suppress.current = false; return; } tapBox(b.id); }}>
            {val[b.id] ? <span className="fm-w">{wordText(val[b.id])}</span> : <span className="fm-n" aria-hidden>{num(b.id)}</span>}
          </button>
        ) : (
          <input data-box={b.id} className={`fm-in ${val[b.id]?.trim() ? "filled" : ""}`} style={{ width: `${Math.max(width, Math.min(26, (val[b.id] || "").length + 2))}ch` }}
            value={val[b.id] || ""} disabled={disabled} placeholder={String(num(b.id))} aria-label={`${t("fm_blank")} ${num(b.id)}`}
            autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => set({ ...val, [b.id]: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const nx = wrap.current?.querySelectorAll<HTMLInputElement>("input.fm-in")[num(b.id)]; nx?.focus(); } }} />
        ), slots[b.id]))}

      {blanks.length > 0 && (
        <div className="fm-foot">
          <span className="fm-dots" aria-hidden>{blanks.map((b) => <i key={b.id} className={(val[b.id] || "").trim() ? "on" : ""} />)}</span>
          <span className="fm-count">{filled} / {blanks.length} {t("fm_filled")}</span>
          {!disabled && filled > 0 && <button type="button" className="fm-clear" onClick={() => { set({}); setSel(null); sfx.back(); }}>{t("fm_clear")}</button>}
        </div>
      )}
      {bankMode && (
        <div className="fm-bank" role="group" aria-label={t("fm_bank")}>
          <span className="fm-bank-t">{t("fm_bank")}</span>
          {bank.map((w, i) => {
            const used = !!usedBy(w.id);
            return (
              <button key={w.id} type="button" data-seg={`opt-${w.id}`} disabled={disabled || used} style={{ "--i": i } as React.CSSProperties}
                className={`fm-chip ${used ? "used" : ""} ${sel === w.id ? "sel" : ""} ${dragging === w.id ? "lifting" : ""}`}
                aria-pressed={sel === w.id} aria-label={used ? `${w.text} (${t("fm_used")})` : w.text}
                onPointerDown={(e) => down(e, w.id, null)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={kb(() => tapWord(w.id))}>
                {w.text}
              </button>
            );
          })}
          {!disabled && <p className="fm-help">{sel ? t("fm_tap_blank") : t("fm_help")}</p>}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{said}</span>
    </div>
  );
}
