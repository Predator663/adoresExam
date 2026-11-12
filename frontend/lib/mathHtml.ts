/** Turns what a teacher types naturally into tidy formula HTML (only the tags the server keeps: span with class, sup, sub).
 *    3x^2 + 5x - 2 = 0      →  3x² + 5x − 2 = 0
 *    (x+1)/(x-1)            →  a stacked fraction
 *    sqrt(x^2+1)            →  a square root with a bar
 *    x_1, a_{n+1}, 10^-3    →  subscripts and powers
 *  Everything typed is escaped, so nothing a teacher types can become markup. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => esc(s).replace(/"/g, "&quot;");

export const fracHtml = (n: string, d: string) => `<span class="mfrac"><span class="mnum">${n}</span><span class="msr"> over </span><span class="mden">${d}</span></span>`;
export const rootHtml = (inner: string, index = "") => `<span class="msqrt">${index ? `<sup class="mindex">${index}</sup>` : ""}√<span class="mrad">${inner}</span></span>`;

function closer(s: string, i: number, open: string, close: string): number {  // index of the bracket that closes the one at s[i], or -1
  let depth = 0;
  for (let j = i; j < s.length; j++) { if (s[j] === open) depth++; else if (s[j] === close && --depth === 0) return j; }
  return -1;
}

type Chunk = { html: string; bare?: string };
type Item = { k: "chunk"; c: Chunk } | { k: "op"; html: string } | { k: "slash" };

/** The ^ or _ arguments that follow a base: ^2, ^-1, ^n, ^{n+1}, ^(n+1). Returns the HTML and where the text continues. */
function scripts(s: string, i: number): { html: string; next: number } {
  let html = "";
  while (s[i] === "^" || s[i] === "_") {
    const tag = s[i] === "^" ? "sup" : "sub";
    let arg = "", j = i + 1;
    if (s[j] === "{" || s[j] === "(") {
      const e = closer(s, j, s[j], s[j] === "{" ? "}" : ")");
      if (e < 0) break;
      arg = s.slice(j + 1, e); j = e + 1;
    } else {
      const m = s.slice(j).match(/^[+\-−]?(?:\d+(?:\.\d+)?|[A-Za-z])/);
      if (!m) break;
      arg = m[0]; j += arg.length;
    }
    html += `<${tag}>${renderMath(arg)}</${tag}>`; i = j;
  }
  return { html, next: i };
}

export function renderMath(src: string): string {
  const items: Item[] = [];
  let cur: Chunk | null = null, i = 0;
  const flush = () => { if (cur) { items.push({ k: "chunk", c: cur }); cur = null; } };
  const add = (html: string, bare?: string) => { if (cur) cur = { html: cur.html + html }; else cur = { html, bare }; };
  while (i < src.length) {
    const c = src[i];
    if (src.startsWith("sqrt(", i)) {
      const e = closer(src, i + 4, "(", ")");
      if (e > 0) { const sc = scripts(src, e + 1); add(rootHtml(renderMath(src.slice(i + 5, e))) + sc.html); i = sc.next; continue; }
    }
    if (c === "(") {
      const e = closer(src, i, "(", ")");
      if (e > 0) { const inner = renderMath(src.slice(i + 1, e)), sc = scripts(src, e + 1); add(`(${inner})${sc.html}`, sc.html ? undefined : inner); i = sc.next; continue; }
    }
    if (/[A-Za-z0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const pi = word.match(/^(\d*\.?\d*)pi$/);  // pi, 2pi
      if (pi) { const sc = scripts(src, j); add(esc(pi[1]) + "π" + sc.html); i = sc.next; continue; }
      if (src[j] === "^" || src[j] === "_") {  // the power or subscript belongs to the last letter or number only: 3x^2 is 3 and x²
        const m = word.match(/(\d+(?:\.\d+)?|[A-Za-z])$/)!, sc = scripts(src, j);
        add(esc(word.slice(0, word.length - m[0].length)) + esc(m[0]) + sc.html); i = sc.next; continue;
      }
      add(esc(word)); i = j; continue;
    }
    flush();
    if (c === "/") { items.push({ k: "slash" }); i++; continue; }
    const two = src.slice(i, i + 2);
    const sym: Record<string, string> = { "<=": "≤", ">=": "≥", "!=": "≠", "+-": "±", "->": "→" };
    if (sym[two]) { items.push({ k: "op", html: sym[two] }); i += 2; continue; }
    items.push({ k: "op", html: c === "*" ? "×" : c === "-" ? "−" : esc(c) }); i++;
  }
  flush();
  // a/b between two neighbours becomes a stacked fraction (a chain like a/b/c is read left to right)
  const out: Item[] = [];
  for (let p = 0; p < items.length; p++) {
    const it = items[p], prev = out[out.length - 1], next = items[p + 1];
    if (it.k === "slash" && prev?.k === "chunk" && next?.k === "chunk") {
      out[out.length - 1] = { k: "chunk", c: { html: fracHtml(prev.c.bare ?? prev.c.html, next.c.bare ?? next.c.html) } }; p++;
    } else out.push(it.k === "slash" ? { k: "op", html: "/" } : it);
  }
  return out.map((x) => (x.k === "chunk" ? x.c.html : x.k === "op" ? x.html : "/")).join("");
}

/** The finished piece that goes into the question: the formula with the teacher's own typing kept in data-formula. */
export const mathSpan = (inner: string, src: string) => `<span class="math" data-formula="${attr(src)}">${inner}</span>`;
export const mathHtml = (src: string) => mathSpan(renderMath(src), src);

/** "H2O" → H₂O, "SO4^2-" → SO₄²⁻, "Ca(OH)2" → Ca(OH)₂ */
export function chemHtml(src: string): string {
  const [body, charge] = src.split("^");
  const h = esc(body).replace(/([A-Za-z)\]])(\d+)/g, "$1<sub>$2</sub>");
  return charge ? `${h}<sup>${esc(charge).replace(/-/g, "−")}</sup>` : h;
}
