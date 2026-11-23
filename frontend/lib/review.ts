/** Shared by the student's "Full exam" tab and the question-by-question review: what each answer was worth, and which parts of it were right. */
export type RQ = {
  number: number; voided: boolean; type: "mcq_single" | "mcq_multi" | "true_false" | "matching" | "fill_blank" | "fill_multi" | "ordering";
  prompt: string; content: any; marks: number; your_response: any; skipped: boolean; timed_out: boolean; marks_awarded: number;
  correct_answer: any; explanation: string; topic?: string; section?: string;
};
/** full = all the marks, part = some, none = a wrong answer, skip = no answer given, void = the question was removed. */
export type Verdict = "full" | "part" | "none" | "skip" | "void";
/** What one part of an answer looks like: ok = right (question fully right), mid = right but the question is only partly right (orange),
 *  bad = wrong (red), miss = not answered, "" = no judgement. */
export type Part = "ok" | "mid" | "bad" | "miss" | "";

export const answered = (v: any): boolean =>
  !(v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.values(v).some((x) => String(x ?? "").trim() !== "")));

export function verdictOf(q: RQ): Verdict {
  if (q.voided) return "void";
  const got = q.marks_awarded || 0;
  if (got >= q.marks - 1e-9) return "full";
  if (got > 0) return "part";
  return q.skipped || q.timed_out || !answered(q.your_response) ? "skip" : "none";
}

/** A part she got right is green when the whole question is right, and orange when it is only partly right. */
export const rightPart = (v: Verdict): Part => (v === "full" ? "ok" : "mid");

export const pairsOf = (a: any): Record<string, string> => (a && typeof a === "object" ? a.pairs || a : {}) as Record<string, string>;

/** Matching: the state of one pair (by its left item). Right = orange/green, wrong = red, nothing chosen = miss. */
export function pairPart(q: RQ, leftId: string): Part {
  const mine = pairsOf(q.your_response)[leftId], key = pairsOf(q.correct_answer)[leftId], v = verdictOf(q);
  if (!mine) return "miss";
  return mine === key ? rightPart(v) : "bad";
}

const norm = (s: any) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Several blanks: the state of blank number i (0-based). A fully right or fully wrong question needs no checking. */
export function blankPart(q: RQ, i: number): Part {
  const v = verdictOf(q), c = q.content || {}, id = c.blanks?.[i]?.id;
  const mine = (q.your_response || {})[id];
  if (mine === undefined || String(mine).trim() === "") return "miss";
  if (v === "full") return "ok";
  if (v === "none" || v === "skip") return "bad";
  const bank: Record<string, string> = {};
  for (const w of c.bank || []) bank[w.id] = w.text;
  const given = c.mode === "bank" ? bank[mine] ?? mine : mine;
  const accepted: string[] = q.correct_answer?.blanks?.[id]?.accepted || [];
  return accepted.some((a) => norm(a) === norm(given)) ? "mid" : "bad";
}

/** An ordering answer (hers or the key) as a list of item ids. */
export const orderOf = (a: any): string[] => (Array.isArray(a) ? a : Array.isArray(a?.order) ? a.order : []);

/** Ordering: the state of the item she put in position i. */
export function orderPart(q: RQ, i: number): Part {
  const v = verdictOf(q), mine = orderOf(q.your_response), right = orderOf(q.correct_answer);
  if (!mine[i]) return "miss";
  if (v === "full") return "ok";
  if (v === "none" || v === "skip") return "bad";
  return mine[i] === right[i] ? "mid" : "bad";
}

