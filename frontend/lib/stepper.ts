/** Small pure helpers for the accessibility sliders (components/A11yPanel.tsx). */

/** Round to the slider's step, stay inside min..max, and avoid float noise such as 1.2000000000000002. */
export function snap(v: number, min: number, max: number, step: number): number {
  const n = Math.round((v - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, n)).toFixed(4));
}

/** Did the finger / pointer land ON the slider's round handle (or very close to it), and not just somewhere on the bar?
 *  x is measured from the left edge of the slider, width is the slider's width. The handle's centre moves with the value. */
export function nearHandle(x: number, width: number, value: number, min: number, max: number, handlePx = 28, slack = 22): boolean {
  if (width <= handlePx) return true;
  const centre = handlePx / 2 + ((value - min) / (max - min)) * (width - handlePx);
  return Math.abs(x - centre) <= handlePx / 2 + slack;
}
