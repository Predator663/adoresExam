import type { KeyboardEvent } from "react";

/** Typing fast in the question forms: Enter jumps to the next field, Shift+Enter starts a new line.
 *  Put it on a container as `onKeyDownCapture={enterToNext}`; it works across every field inside (text boxes, number boxes,
 *  drop-downs, the rich text editors). Enter still behaves normally inside a bulleted/numbered list, in dialogs and on buttons. */
const FIELDS = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, select, [contenteditable="true"]';

/** A field she can actually type in right now: not disabled, not inside a folded card, closed "more details" or hidden pane. */
function usable(el: HTMLElement) {
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false;
  if (el.closest('[hidden], .bk-body:not(.open), details:not([open]) > :not(summary)')) return false;
  return el.getClientRects().length > 0;
}

export function enterToNext(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
  const t = e.target as HTMLElement;
  if (!t.matches?.(FIELDS)) return;
  if (t.closest('[role="dialog"], [aria-modal="true"], dialog')) return;
  if (t.isContentEditable) {  // keep Enter for adding the next bullet / number while she is writing a list
    const a = getSelection()?.anchorNode;
    if (a && (a.nodeType === 1 ? (a as Element) : a.parentElement)?.closest("li")) return;
  }
  e.preventDefault();
  const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FIELDS)).filter(usable);
  const next = all[all.indexOf(t) + 1];
  if (!next) return;
  next.focus();
  if (next.isContentEditable) {  // caret at the end of what is already written
    const r = document.createRange(); r.selectNodeContents(next); r.collapse(false);
    const s = getSelection(); s?.removeAllRanges(); s?.addRange(r);
  }
}
