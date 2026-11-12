"use client";
import { useCallback, useEffect, useState } from "react";

/** Read-aloud with the phone's own voices (English and Swahili where the device supports them).
 *  This file: speech support, turning question HTML (formulas, powers, fractions, symbols) into words that sound right,
 *  and the student's reading settings, remembered on the phone. */
export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;
export type Lang = "en" | "sw";

const W: Record<Lang, { over: string; sq: string; cube: string; pow: string; sub: string; root: string; croot: string; nth: string; of: string; and: string; img: string; charge: string; plus: string; minus: string }> = {
  en: { over: "over", sq: "squared", cube: "cubed", pow: "to the power of", sub: "sub", root: "square root of", croot: "cube root of", nth: "root number", of: "of", and: "and", img: "Image", charge: "with charge", plus: "plus", minus: "minus" },
  sw: { over: "juu ya", sq: "mraba", cube: "mchemraba", pow: "kwa kipeo cha", sub: "chini", root: "kipeo cha pili cha", croot: "kipeo cha tatu cha", nth: "kipeo namba", of: "cha", and: "na", img: "Picha", charge: "chaji", plus: "jumlisha", minus: "toa" },
};
const SYM: Record<Lang, Record<string, string>> = {
  en: { "+": "plus", "−": "minus", "×": "times", "÷": "divided by", "=": "equals", "≠": "is not equal to", "≈": "is approximately", "≤": "is less than or equal to", "≥": "is greater than or equal to", "<": "is less than", ">": "is greater than", "±": "plus or minus", "π": "pi", "°": "degrees", "²": "squared", "³": "cubed", "½": "one half", "¼": "one quarter", "¾": "three quarters", "√": "square root of", "∞": "infinity", "∑": "sum", "∆": "delta", "θ": "theta", "α": "alpha", "β": "beta", "γ": "gamma", "λ": "lambda", "μ": "mu", "Ω": "omega", "∠": "angle", "⊥": "is perpendicular to", "∥": "is parallel to", "∴": "therefore", "∈": "belongs to", "∪": "union", "∩": "intersection", "‰": "per mille", "£": "pounds", "€": "euros", "→": "gives", "←": "left arrow", "⇌": "reversible reaction arrow", "↑": "up arrow", "↓": "down arrow" },
  sw: { "+": "jumlisha", "−": "toa", "×": "mara", "÷": "gawanya kwa", "=": "ni sawa na", "≠": "si sawa na", "≈": "ni takriban sawa na", "≤": "ni ndogo kuliko au sawa na", "≥": "ni kubwa kuliko au sawa na", "<": "ni ndogo kuliko", ">": "ni kubwa kuliko", "±": "jumlisha au toa", "π": "pai", "°": "nyuzi", "²": "mraba", "³": "mchemraba", "½": "nusu", "¼": "robo", "¾": "robo tatu", "√": "kipeo cha pili cha", "∞": "usio na mwisho", "∑": "jumla", "∆": "delta", "θ": "theta", "α": "alfa", "β": "beta", "γ": "gama", "λ": "lamda", "μ": "mu", "Ω": "omega", "∠": "pembe", "⊥": "ni wima kwa", "∥": "ni sambamba na", "∴": "kwa hiyo", "∈": "ni mwanachama wa", "∪": "muungano", "∩": "makutano", "‰": "kwa elfu", "£": "pauni", "€": "yuro", "→": "inakuwa", "←": "mshale wa kushoto", "⇌": "mwitikio wa kurudi na kwenda", "↑": "mshale wa juu", "↓": "mshale wa chini" },
};
const SYM_RE = /[+−×÷=≠≈≤≥<>±π°²³½¼¾√∞∑∆θαβγλμΩ∠⊥∥∴∈∪∩‰£€→←⇌↑↓]/g;
const BLOCK = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "TR", "BR"]);

/** Question HTML → plain words for the voice. 3x² → "3 x squared", a stacked fraction → "3 over 4", √ → "square root of", H₂O → "H 2 O". */
export function spokenText(html: string, lang: Lang = "en"): string {
  if (typeof document === "undefined") return "";
  const L = W[lang] || W.en;
  const d = document.createElement("div");
  d.innerHTML = html || "";
  const say = (n: Node): string => {
    if (n.nodeType === 3) return n.nodeValue || "";
    if (n.nodeType !== 1) return "";
    const e = n as HTMLElement, tag = e.tagName, cl = e.classList;
    if (cl.contains("msr")) return "";
    if (tag === "IMG") return ` ${L.img}: ${e.getAttribute("alt") || ""}. `;
    if (cl.contains("mfrac")) {  // a long top or bottom gets pauses, so (x+1)/(x-1) is not heard as x + 1/x - 1
      const a = say(e.querySelector(".mnum") || e).trim(), b = say(e.querySelector(".mden") || e).trim(), long = /[\s+−×÷=]/.test(a + b);
      return long ? `, ${a}, ${L.over}, ${b}, ` : ` ${a} ${L.over} ${b} `;
    }
    if (cl.contains("mwhole")) return ` ${kids(e)} ${L.and} `;
    if (cl.contains("msqrt")) {
      const idx = e.querySelector(".mindex")?.textContent?.trim(), inner = kids(e.querySelector(".mrad") || e);
      return ` ${!idx ? L.root : idx === "3" ? L.croot : `${L.nth} ${idx} ${L.of}`} ${inner} `;
    }
    if (tag === "SUP") {
      const s = (e.textContent || "").trim();
      if (s === "2") return ` ${L.sq} `;
      if (s === "3") return ` ${L.cube} `;
      const ch = s.match(/^(\d*)([+−-])$/);  // an ion charge such as 2−
      if (ch) return ` ${L.charge} ${ch[1]} ${ch[2] === "+" ? L.plus : L.minus} `;
      return ` ${L.pow} ${kids(e)} `;
    }
    if (tag === "SUB") {
      const s = (e.textContent || "").trim(), before = (e.previousSibling?.textContent || "").slice(-1);
      return /^\d+$/.test(s) && /[A-Z)\]]/.test(before) ? ` ${s} ` : ` ${L.sub} ${kids(e)} `;  // H₂O is read "H 2 O", x₁ is read "x sub 1"
    }
    return kids(e) + (BLOCK.has(tag) ? ". " : "");
  };
  const kids = (e: Node) => Array.from(e.childNodes).map(say).join("");
  const sy = SYM[lang] || SYM.en;
  return kids(d).replace(SYM_RE, (c) => ` ${sy[c]} `).replace(/\s+/g, " ").replace(/(\s*\.){2,}/g, ".").replace(/\s+([.,;:?!])/g, "$1").trim();
}
export const htmlToText = (html: string) => spokenText(html, "en");

/** Short pieces, so the voice never stops half way through a long text (a known problem on some phones) and so we can skip back and forth. */
export function splitSentences(text: string, max = 200): string[] {
  const out: string[] = [];
  for (const s of text.replace(/([.!?;:])\s+/g, "$1\u0001").split("\u0001")) {
    let r = s.trim();
    while (r.length > max) {
      let cut = r.lastIndexOf(",", max); if (cut < 40) cut = r.lastIndexOf(" ", max); if (cut < 1) cut = max;
      out.push(r.slice(0, cut + 1).trim()); r = r.slice(cut + 1).trim();
    }
    if (r) out.push(r);
  }
  return out;
}

/* ---------- the student's reading settings (kept on the phone) ---------- */
export type ReadPrefs = { voice: string; rate: number; pitch: number; volume: number; auto: boolean | null; options: boolean; marks: boolean; highlight: boolean; lang: "app" | Lang };
export const DEFAULT_PREFS: ReadPrefs = { voice: "", rate: 1, pitch: 1, volume: 1, auto: null, options: true, marks: false, highlight: true, lang: "app" };  // auto: null = follow the account switch
const KEY = "amani_tts", EVT = "amani:tts";
const readPrefs = (): ReadPrefs => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULT_PREFS; } };

export function useReadPrefs(): [ReadPrefs, (p: Partial<ReadPrefs>) => void, () => void, boolean] {
  const [p, setP] = useState<ReadPrefs>(DEFAULT_PREFS), [ready, setReady] = useState(false);
  useEffect(() => {
    const f = () => setP(readPrefs());
    f(); setReady(true);
    window.addEventListener(EVT, f); window.addEventListener("storage", f);
    return () => { window.removeEventListener(EVT, f); window.removeEventListener("storage", f); };
  }, []);
  const save = (n: ReadPrefs) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode: the choice lasts until the page closes */ } window.dispatchEvent(new Event(EVT)); };
  const update = useCallback((patch: Partial<ReadPrefs>) => save({ ...readPrefs(), ...patch }), []);
  const reset = useCallback(() => save(DEFAULT_PREFS), []);
  return [p, update, reset, ready];
}

export function useVoices(): SpeechSynthesisVoice[] {
  const [v, setV] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported()) return;
    const s = window.speechSynthesis, f = () => setV(s.getVoices());
    f(); s.addEventListener?.("voiceschanged", f);
    return () => s.removeEventListener?.("voiceschanged", f);
  }, []);
  return v;
}

export const pickVoice = (voices: SpeechSynthesisVoice[], uri: string, lang: Lang) =>
  voices.find((v) => uri && v.voiceURI === uri) || voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang));

export function makeUtterance(text: string, p: ReadPrefs, voices: SpeechSynthesisVoice[], lang: Lang) {
  const u = new SpeechSynthesisUtterance(text), v = pickVoice(voices, p.voice, lang);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang === "sw" ? "sw-TZ" : "en-GB";
  u.rate = p.rate; u.pitch = p.pitch; u.volume = p.volume;
  return u;
}

/** One-off speech with default settings (kept for older callers). */
export function speak(text: string, lang: string) {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(makeUtterance(text, DEFAULT_PREFS, window.speechSynthesis.getVoices(), lang === "sw" ? "sw" : "en"));
}
export const stopSpeaking = () => speechSupported() && window.speechSynthesis.cancel();
