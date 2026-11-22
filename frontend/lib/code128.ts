/** Code 128 (subset B) barcodes, drawn as SVG. Every home package carries one, so a scanner finds the student in one scan.
 *  Subset B holds every printable ASCII character (space to ~). Nothing here needs the internet or a library. */

// The bar/space widths of the 107 symbols (0-102 data, 103-105 start A/B/C, 106 stop), as digits: bar, space, bar, space, bar, space (stop has a 7th: the last bar).
const PATTERNS = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
const START_B = 104, STOP = 106;

/** The symbols of `text`: start, one per character, check symbol, stop. Throws for a character subset B cannot hold. */
export function code128Symbols(text: string): number[] {
  if (!text) throw new Error("Nothing to encode");
  const out = [START_B];
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error("Character not allowed in a barcode: " + ch);
    out.push(v);
  }
  let sum = START_B;
  for (let i = 1; i < out.length; i++) sum += out[i] * i;
  out.push(sum % 103, STOP);
  return out;
}

/** The bars as [x, width] pairs in modules, and the total width in modules (without the quiet zone). */
export function code128Bars(text: string): { bars: [number, number][]; width: number } {
  const bars: [number, number][] = [];
  let x = 0;
  for (const s of code128Symbols(text)) {
    const p = PATTERNS[s];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) bars.push([x, w]);
      x += w;
    }
  }
  return { bars, width: x };
}
