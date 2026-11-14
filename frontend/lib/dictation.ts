/** Turns what the speech engine heard into clean written English: spoken punctuation ("full stop", "comma", "new line"),
 *  capital letters at the start of a sentence and for "I", and the right spaces. Pure text in, text out, so it is easy to test. */
export type Spoken = { text: string; action?: "undo" | "stop" };

const WORDS: [RegExp, string][] = [
  [/\b(full stop)\b/gi, "."], [/\bcomma\b/gi, ","], [/\bquestion mark\b/gi, "?"], [/\bexclamation (mark|point)\b/gi, "!"],
  [/\bsemi[- ]?colon\b/gi, ";"], [/\bcolon\b/gi, ":"], [/\b(open|left) (bracket|parenthesis)\b/gi, "("], [/\b(close|right) (bracket|parenthesis)\b/gi, ")"],
  [/\bhyphen\b/gi, "-"], [/\bnew paragraph\b/gi, "\n\n"], [/\b(new|next) line\b/gi, "\n"],
];

export function formatDictation(raw: string, before: string, oneLine = false): Spoken {
  let t = raw.trim();
  const bare = t.toLowerCase().replace(/[.,!?]+$/g, "");
  if (/^(scratch that|delete that|undo that)$/.test(bare)) return { text: "", action: "undo" };
  if (/^(stop (dictation|listening|recording)|end dictation)$/.test(bare)) return { text: "", action: "stop" };
  if (!t) return { text: "" };
  if (/^period$/i.test(bare)) t = ".";  // alone it means the mark; inside a sentence ("time period") it is just a word
  for (const [re, to] of WORDS) t = t.replace(re, to);
  t = t.replace(/\s+([.,;:?!)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s*\n\s*/g, "\n");
  if (oneLine) t = t.replace(/\n+/g, " ").replace(/\s{2,}/g, " ");
  t = t.replace(/\bi\b/g, "I").replace(/\bI'(m|ll|ve|d)\b/gi, "I'$1");
  const up = (s: string) => s.replace(/^(\s*)([a-z])/, (_, a, b) => a + b.toUpperCase());
  const start = /(^|[.?!]\s*|\n\s*)$/.test(before);
  t = t.replace(/([.?!]\s+|\n)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  if (start) t = up(t);
  const gap = before && !/[\s(\n]$/.test(before) && !/^[\s.,;:?!)\n]/.test(t) ? " " : "";
  return { text: gap + t };
}
