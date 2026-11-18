/** Per-question time limits (mirrors exams/timing.py: the server has the last word). */
export const MIN_SECONDS = 10, MAX_SECONDS = 3600;
const BASE: Record<string, number> = { true_false: 45, mcq_single: 60, mcq_multi: 90, fill_blank: 60, matching: 120, ordering: 90 };

export const clampSecs = (n: number) => Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(n)));

/** A sensible limit for a question that has none: by type, a little more for longer ones. */
export function defaultLimit(qtype: string, content?: any, marks: number | string = 1): number {
  let secs: number;
  if (qtype === "fill_multi") secs = 30 + 20 * ((content?.blanks?.length as number) || 3);
  else if (qtype === "matching") secs = 30 + 20 * ((content?.left?.length as number) || 4);
  else if (qtype === "ordering") secs = 30 + 12 * ((content?.items?.length as number) || 5);
  else secs = BASE[qtype] ?? 90;
  const m = Number(marks);
  if (m > 2) secs += Math.floor((m - 2) * 15);
  return clampSecs(secs);
}

/** "45 s", "1 min", "1 min 30 s" */
export function fmtSecs(n: number): string {
  const s = Math.max(0, Math.round(n)), m = Math.floor(s / 60), r = s % 60;
  if (!m) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** "0:45" for the countdown */
export const clockSecs = (n: number) => { const s = Math.max(0, Math.ceil(n)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export const limitProblem = (n: number | null | undefined): string =>
  n == null ? "" : !Number.isFinite(n) || n < MIN_SECONDS || n > MAX_SECONDS ? `Time limit must be between ${MIN_SECONDS} seconds and ${MAX_SECONDS / 60} minutes.` : "";
