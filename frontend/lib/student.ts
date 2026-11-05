/** Small helpers for the student screens: greeting, per-subject colour, grade tone, result wording. */

/** Tanzania is UTC+3 all year, so the hour is read from the clock without needing the phone's time zone. */
export function eatHour(ms: number = Date.now()): number { return new Date(ms + 3 * 3_600_000).getUTCHours(); }
export function greetKey(hour: number = eatHour()): "greet_morning" | "greet_afternoon" | "greet_evening" {
  return hour < 12 ? "greet_morning" : hour < 18 ? "greet_afternoon" : "greet_evening";
}
/** The same subject always gets the same hue, so Chemistry is "its" colour on every screen. */
export function hueOf(text: string): number {
  let h = 7;
  for (const c of text || "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
export const initialOfName = (s: string) => ((s || "?").trim()[0] || "?").toUpperCase();
/** A, B = good, C = fair, D = needs care, F = needs help. */
export function gradeTone(grade: string): "good" | "fair" | "warn" | "bad" {
  const g = (grade || "").trim().toUpperCase()[0];
  return g === "A" || g === "B" ? "good" : g === "C" ? "fair" : g === "D" ? "warn" : "bad";
}
export function resultMessageKey(percent: number): "res_msg_top" | "res_msg_good" | "res_msg_ok" | "res_msg_low" {
  return percent >= 80 ? "res_msg_top" : percent >= 60 ? "res_msg_good" : percent >= 40 ? "res_msg_ok" : "res_msg_low";
}
export const safePercent = (n: number, total: number) => (total > 0 && Number.isFinite(n) ? Math.max(0, Math.min(100, (n / total) * 100)) : 0);
