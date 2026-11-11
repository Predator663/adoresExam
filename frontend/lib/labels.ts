/** Numbering of the two columns in a matching question: Column A (left) is (i) (ii) (iii) and Column B (right) is A B C by default,
 *  the way a Tanzanian exam paper sets it. The teacher can choose other styles per question. */
export type LeftStyle = "roman" | "ROMAN" | "number";
export type RightStyle = "LETTER" | "letter" | "number";
export type MatchLayout = { left_style: LeftStyle; right_style: RightStyle; left_title: string; right_title: string; shuffle_right: boolean; unique: boolean };

const ROMANS: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function roman(n: number): string {  // 1 → I, 4 → IV, 14 → XIV
  let out = "";
  for (const [v, s] of ROMANS) while (n >= v) { out += s; n -= v; }
  return out;
}
export function letters(n: number): string {  // 1 → A, 26 → Z, 27 → AA
  let out = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

/** The little marker in front of the i-th (0-based) left item, e.g. "(i)". */
export function leftMark(style: LeftStyle | undefined, i: number): string {
  if (style === "number") return `(${i + 1})`;
  return `(${style === "ROMAN" ? roman(i + 1) : roman(i + 1).toLowerCase()})`;
}
/** The tag of the i-th right item without the dot, e.g. "B". This is what the student picks. */
export function rightTag(style: RightStyle | undefined, i: number): string {
  if (style === "number") return String(i + 1);
  return style === "letter" ? letters(i + 1).toLowerCase() : letters(i + 1);
}
export const rightMark = (style: RightStyle | undefined, i: number) => `${rightTag(style, i)}.`;

/** Layout of a matching question, with the defaults for questions saved before these settings existed. */
export function matchLayout(content: any): MatchLayout {
  const l = content?.layout || {};
  return { left_style: l.left_style || "roman", right_style: l.right_style || "LETTER", left_title: l.left_title || "", right_title: l.right_title || "",
    shuffle_right: l.shuffle_right !== false, unique: l.unique === true };
}
