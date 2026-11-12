"use client";
import { RefObject, useState } from "react";
import { Modal } from "./ui";

/** Characters teachers and students need in maths, science and geography answers. */
export const SYMBOLS = "+ − ± × ÷ = ≠ ≈ ≤ ≥ < > π √ ∞ ∑ ∆ θ α β γ λ μ Ω ² ³ ½ ¼ ¾ → ← ⇌ ↑ ↓ ∠ ⊥ ∥ ∴ ∈ ∪ ∩ ‰ £ €".split(" ");

/** A button that opens the symbol list and types the chosen symbol into a plain text box or text area, at the cursor.
 *  Only ordinary characters are inserted (no formatting), so the answer still compares correctly when it is marked. */
export default function SymbolPad({ target, value, onChange, label = "Ω Symbols", aria = "Insert a symbol", small }: {
  target: RefObject<HTMLInputElement | HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void; label?: string; aria?: string; small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  function pick(sym: string) {
    const el = target.current, a = el?.selectionStart ?? value.length, b = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, a) + sym + value.slice(b));
    setOpen(false);
    setTimeout(() => { el?.focus(); el?.setSelectionRange(a + sym.length, a + sym.length); }, 0);
  }
  return (
    <>
      <button type="button" className={`btn${small ? " icon" : ""}`} aria-label={aria} title={aria} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Modal label="Symbols" onClose={() => setOpen(false)}>
          <h2>Symbols</h2>
          <div className="chips">{SYMBOLS.map((s) => <button type="button" key={s} className="btn icon" aria-label={s} onClick={() => pick(s)}>{s}</button>)}</div>
          <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
        </Modal>
      )}
    </>
  );
}
