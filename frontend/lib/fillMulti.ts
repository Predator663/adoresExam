/** Helpers for the "fill in the blanks (several)" question. The teacher types ____ in the question text; it is stored as [[1]] [[2]] ... */
export const BLANK_RUN = /_{3,}/g;
/** How many blanks the teacher has typed (each run of three or more underscores is one). */
export const blankCount = (html: string): number => (html.match(BLANK_RUN) || []).length;
/** ____ -> [[1]], [[2]] ... (what is saved) */
export const toTokens = (html: string): string => { let n = 0; return html.replace(BLANK_RUN, () => `[[${++n}]]`); };
/** [[1]] -> _____ (what the teacher edits) */
export const fromTokens = (html: string): string => html.replace(/\[\[\d+\]\]/g, "_____");
/** "walking; going" -> ["walking", "going"] */
export const splitAlt = (s: string): string[] => [...new Set((s || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean))];
/** A word bank is the first answer of every blank, then the extra wrong words. */
export const splitWords = (s: string): string[] => [...new Set((s || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
