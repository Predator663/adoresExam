import type { Question } from "./types";

/** One question inside an offline practice pack (answers included: practice questions are never in an upcoming exam). */
export type PackQuestion = { id: number; type: Question["type"]; prompt: string; marks: number; content: any; answer: any; explanation: string; topic?: string };

const PUNCT = /[.,;:!?'"’‘“”\-–—()[\]{}]/g;
/** Same as the server's _norm: extra spaces never matter; capitals and punctuation matter only if the teacher said so. */
const norm = (s: any, caseSensitive = false, ignorePunct = false) => {
  let t = String(s);
  if (ignorePunct) t = t.replace(PUNCT, "");
  t = t.split(/\s+/).filter(Boolean).join(" ");
  return caseSensitive ? t : t.toLowerCase();
};
const num = (s: any): number | null => {
  const t = String(s).replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The same rules as the server (exams/marking.py, with partial marks on as in practice mode): 0 to 1. */
export function fractionCorrect(type: Question["type"], ans: any, response: any): number {
  if (response === null || response === undefined) return 0;
  switch (type) {
    case "mcq_single": return response === ans.correct ? 1 : 0;
    case "mcq_multi": {
      if (!Array.isArray(response)) return 0;
      const chosen = new Set<string>(response), correct = new Set<string>(ans.correct);
      const right = [...chosen].filter((x) => correct.has(x)).length, wrong = chosen.size - right;
      if (chosen.size === correct.size && right === correct.size) return 1;
      return Math.max(0, (right - wrong) / correct.size);
    }
    case "true_false": {
      let v = response;
      if (typeof v === "string") v = ({ true: true, false: false } as Record<string, boolean>)[v.trim().toLowerCase()];
      return v === ans.correct ? 1 : 0;
    }
    case "matching": {
      if (typeof response !== "object" || Array.isArray(response)) return 0;
      const keys = Object.keys(ans.pairs || {});
      if (!keys.length) return 0;
      const right = keys.filter((k) => response[k] === ans.pairs[k]).length;
      if (right === keys.length) return 1;
      return ans.partial === "all" ? 0 : right / keys.length;  // practice gives partial marks unless this question says all-or-nothing
    }
    case "fill_blank": {
      const cs = !!ans.case_sensitive, ip = !!ans.ignore_punct, text = norm(response, cs, ip);
      if ((ans.accepted || []).some((a: any) => text === norm(a, cs, ip))) return 1;
      const n = ans.numeric, v = num(response);
      if (n && v !== null && Math.abs(v - n.value) <= n.tolerance + 1e-9) return 1;
      return 0;
    }
    case "ordering": {
      if (!Array.isArray(response)) return 0;
      const correct: string[] = ans.order || [];
      if (!correct.length) return 0;
      if (response.length === correct.length && response.every((x, i) => x === correct[i])) return 1;
      let same = 0;
      for (let i = 0; i < Math.min(response.length, correct.length); i++) if (response[i] === correct[i]) same++;
      return same / correct.length;
    }
  }
  return 0;
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** What the student sees: options mixed up, and an ordering question never arrives already in the right order. */
export function presentQuestion(q: PackQuestion): Question {
  const content = JSON.parse(JSON.stringify(q.content || {}));
  if ((q.type === "mcq_single" || q.type === "mcq_multi") && content.options) content.options = shuffled(content.options);
  if (q.type === "matching" && content.right && content.layout?.shuffle_right !== false) content.right = shuffled(content.right);
  if (q.type === "ordering" && content.items) {
    const right: string[] = q.answer?.order || [];
    let items = shuffled<any>(content.items);
    for (let i = 0; i < 10 && items.length > 1 && items.every((x: any, k: number) => x.id === right[k]); i++) items = shuffled(items);
    content.items = items;
  }
  return { id: q.id, type: q.type, prompt: q.prompt, marks: q.marks, content };
}

export const pickQuestions = (all: PackQuestion[], n: number) => shuffled(all).slice(0, Math.max(1, Math.min(n, all.length)));
