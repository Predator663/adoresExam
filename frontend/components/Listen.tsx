"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, useModalClose } from "./ui";
import { DEFAULT_PREFS, Lang, ReadPrefs, makeUtterance, pickVoice, speechSupported, splitSentences, spokenText, useReadPrefs, useVoices } from "@/lib/speech";
import { leftMark, matchLayout, rightMark } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";

const KEYS = "ABCDEFGHIJ";
type Seg = { key: string; text: string };  // key = the data-seg of the part of the question on screen, so it can be highlighted

/** The question, cut into the parts the student hears one after another. */
export function questionSegments(q: Question, t: (k: string, v?: Record<string, string | number>) => string, lang: Lang, p: ReadPrefs): Seg[] {
  const c = q.content || {}, out: Seg[] = [], say = (h: string) => spokenText(h, lang);
  const opt = t("ra_option"), img = t("ra_image");
  const body = (o: any) => [o.text ? say(o.text) : "", o.alt_text ? `${img}: ${o.alt_text}` : ""].filter(Boolean).join(". ");
  out.push({ key: "prompt", text: say(q.prompt) });
  if (p.marks) out.push({ key: "marks", text: q.marks === 1 ? t("mark_one") : t("marks_n", { n: q.marks }) });
  if (!p.options) return out.filter((s) => s.text);
  if (q.type === "true_false") out.push({ key: "tf", text: t("true_or_false") });
  (c.options || []).forEach((o: any, i: number) => out.push({ key: `opt-${o.id}`, text: `${opt} ${KEYS[i] || i + 1}. ${body(o)}` }));
  if (q.type === "ordering") (c.items || []).forEach((o: any, i: number) => out.push({ key: `opt-${o.id}`, text: `${i + 1}. ${body(o)}` }));
  if (q.type === "matching") {
    const lay = matchLayout(c);
    out.push({ key: "", text: lay.left_title || t("left_side") });
    (c.left || []).forEach((o: any, i: number) => out.push({ key: `opt-${o.id}`, text: `${leftMark(lay.left_style, i)} ${body(o)}` }));
    out.push({ key: "", text: lay.right_title || t("right_side") });
    (c.right || []).forEach((o: any, i: number) => out.push({ key: `opt-${o.id}`, text: `${rightMark(lay.right_style, i)} ${body(o)}` }));
  }
  return out.filter((s) => s.text);
}
/** Kept for older callers: the whole question as one text. */
export const questionText = (q: Question, t: (k: string, v?: Record<string, string | number>) => string, lang: Lang = "en") =>
  questionSegments(q, t, lang, DEFAULT_PREFS).map((s) => s.text).join(". ");

const SPEEDS = [0.75, 1, 1.25, 1.5];
const fmt = (n: number) => `${Number.isInteger(n * 100) ? +n.toFixed(2) : n.toFixed(2)}×`;

/** The reading bar under a question: play / pause, previous and next sentence, speed, and a settings sheet.
 *  It highlights the part being read, and can read each new question by itself. */
export default function Listen({ q }: { q: Question }) {
  const { user, lang: appLang, t } = useSession();
  const [prefs, update, , ready] = useReadPrefs(), voices = useVoices();
  const lang: Lang = prefs.lang === "app" ? appLang : prefs.lang;
  const [status, setStatus] = useState<"idle" | "playing" | "paused">("idle"), [pos, setPos] = useState(0), [cfg, setCfg] = useState(false);

  const sents = useMemo(() => (typeof window === "undefined" ? [] : questionSegments(q, t, lang, prefs).flatMap((s) => splitSentences(s.text).map((text) => ({ seg: s.key, text })))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, t, lang, prefs.options, prefs.marks]);
  const R = useRef({ sents, prefs, voices, lang, status }), run = useRef(0), idx = useRef(0), cur = useRef<SpeechSynthesisUtterance | null>(null);
  R.current = { sents, prefs, voices, lang, status };

  const mark = useCallback((key: string | null) => {
    document.querySelectorAll("[data-reading]").forEach((e) => e.removeAttribute("data-reading"));
    if (!key || !R.current.prefs.highlight) return;
    const el = document.querySelector(`.question [data-seg="${key}"]`) as HTMLElement | null;
    if (!el) return;
    el.setAttribute("data-reading", "1");
    el.scrollIntoView({ block: "nearest", behavior: document.documentElement.classList.contains("reduce-motion") ? "auto" : "smooth" });
  }, []);
  const halt = useCallback(() => { run.current++; if (speechSupported()) window.speechSynthesis.cancel(); }, []);
  const stop = useCallback(() => { halt(); idx.current = 0; setPos(0); setStatus("idle"); mark(null); }, [halt, mark]);
  const pause = useCallback(() => { halt(); setStatus("paused"); }, [halt]);  // a phone's own pause is unreliable, so we stop and carry on from this sentence

  const play = useCallback((from: number) => {
    if (!speechSupported() || !R.current.sents.length) return;
    const id = ++run.current;
    window.speechSynthesis.cancel();
    const go = (i: number) => {
      if (id !== run.current) return;
      const list = R.current.sents;
      if (i >= list.length) { idx.current = 0; setPos(0); setStatus("idle"); mark(null); return; }
      idx.current = i; setPos(i); setStatus("playing"); mark(list[i].seg);
      const u = makeUtterance(list[i].text, R.current.prefs, R.current.voices, R.current.lang);
      u.onend = () => go(i + 1);
      u.onerror = (e) => { if (id === run.current && e.error !== "canceled" && e.error !== "interrupted") go(i + 1); };
      cur.current = u;  // keep a reference: some browsers drop the "end" event of an utterance that was garbage collected
      window.speechSynthesis.speak(u);
    };
    setTimeout(() => go(Math.max(0, Math.min(from, R.current.sents.length - 1))), 60);
  }, [mark]);

  // a new question: stop, and read it by itself if the student wants that
  useEffect(() => {
    stop();
    if (!ready || !speechSupported()) return;
    const on = R.current.prefs.auto ?? !!user?.accessibility.read_aloud;
    const timer = on ? setTimeout(() => play(0), 450) : undefined;
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id, ready]);
  // a changed voice, speed or language is heard straight away
  useEffect(() => {
    if (R.current.status !== "playing") return;
    const timer = setTimeout(() => play(idx.current), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.voice, prefs.rate, prefs.pitch, prefs.volume, prefs.lang]);
  useEffect(() => {  // leaving the screen stops the voice
    const hide = () => { if (document.hidden && R.current.status === "playing") pause(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); halt(); mark(null); };
  }, [pause, halt, mark]);

  if (!speechSupported()) return null;
  const busy = status !== "idle", n = sents.length;
  const faster = () => update({ rate: SPEEDS.find((s) => s > prefs.rate + 0.001) ?? SPEEDS[0] });
  const main = status === "playing" ? pause : () => play(status === "paused" ? idx.current : 0);
  const voice = pickVoice(voices, prefs.voice, lang);
  return (
    <div className="ra" role="group" aria-label={t("listen")}>
      <div className="ra-bar">
        <button type="button" className={`btn ra-main ${status === "playing" ? "on" : ""}`} onClick={main} disabled={!n}>
          {status === "playing" ? `⏸ ${t("ra_pause")}` : status === "paused" ? `▶ ${t("ra_resume")}` : `🔊 ${t("listen")}`}
        </button>
        {busy && <button type="button" className="btn icon" aria-label={t("stop")} title={t("stop")} onClick={stop}>⏹</button>}
        <button type="button" className="btn icon" aria-label={t("ra_prev")} title={t("ra_prev")} disabled={!busy || pos <= 0} onClick={() => play(idx.current - 1)}>⏮</button>
        <button type="button" className="btn icon" aria-label={t("ra_next")} title={t("ra_next")} disabled={!busy || pos >= n - 1} onClick={() => play(idx.current + 1)}>⏭</button>
        <button type="button" className="btn ra-speed" aria-label={`${t("ra_speed")} ${fmt(prefs.rate)}`} title={t("ra_speed")} onClick={faster}>{fmt(prefs.rate)}</button>
        <button type="button" className="btn icon" aria-label={t("ra_settings")} title={t("ra_settings")} onClick={() => setCfg(true)}>⚙</button>
      </div>
      {busy && <div className="ra-prog" role="progressbar" aria-valuemin={1} aria-valuemax={n} aria-valuenow={pos + 1} aria-label={t("ra_pos", { x: pos + 1, y: n })}><i style={{ width: `${((pos + (status === "playing" ? 0.6 : 0.2)) / n) * 100}%` }} /></div>}
      {lang === "sw" && voices.length > 0 && !voice && <p className="muted small ra-note">{t("ra_novoice")}</p>}
      {cfg && <ReadSettings onClose={() => setCfg(false)} />}
    </div>
  );
}

function Done() {
  const close = useModalClose(), { t } = useSession();
  return <button type="button" className="btn primary" onClick={close}>{t("ra_done")}</button>;
}
function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.round(Math.max(min, Math.min(max, v)) * 100) / 100);
  return (
    <div className="ra-field">
      <span className="ra-lab"><b>{label}</b><output>{show(value)}</output></span>
      <div className="a11y-size">
        <button type="button" className="btn a11y-step" aria-label={`${label} −`} disabled={value <= min} onClick={() => set(value - step)}>−</button>
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={show(value)} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" className="btn a11y-step" aria-label={`${label} +`} disabled={value >= max} onClick={() => set(value + step)}>+</button>
      </div>
    </div>
  );
}

/** Everything a student can change about the reading: voice, language, speed, pitch, volume, and what is read and highlighted. */
export function ReadSettings({ onClose }: { onClose: () => void }) {
  const { user, lang: appLang, t } = useSession();
  const [p, update, reset] = useReadPrefs(), voices = useVoices();
  const lang: Lang = p.lang === "app" ? appLang : p.lang;
  const mine = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang)), others = voices.filter((v) => !mine.includes(v));
  const test = () => { if (!speechSupported()) return; window.speechSynthesis.cancel(); window.speechSynthesis.speak(makeUtterance(t("ra_sample"), p, voices, lang)); };
  useEffect(() => () => { if (speechSupported()) window.speechSynthesis.cancel(); }, []);
  const sw = (k: "options" | "marks" | "highlight", label: string) => (
    <label className="switch"><input type="checkbox" checked={p[k]} onChange={(e) => update({ [k]: e.target.checked })} /> {label}</label>);
  return (
    <Modal fit label={t("ra_settings")} onClose={onClose}>
      <div className="fit-head"><h2>🔊 {t("ra_settings")}</h2><CloseX /></div>
      <div className="ra-set">
        <div className="ra-field ra-wide">
          <span className="ra-lab"><b>{t("ra_lang")}</b></span>
          <div className="chips" role="radiogroup" aria-label={t("ra_lang")}>
            {([["app", t("ra_same")], ["en", "English"], ["sw", "Kiswahili"]] as const).map(([k, l]) => (
              <label key={k} className={`chip ${p.lang === k ? "on" : ""}`}><input type="radio" name="ra-lang" checked={p.lang === k} onChange={() => update({ lang: k, voice: "" })} />{p.lang === k ? "✓ " : ""}{l}</label>
            ))}
          </div>
        </div>
        <label className="ra-field ra-wide"><span className="ra-lab"><b>{t("ra_voice")}</b></span>
          <select className="input" value={p.voice} onChange={(e) => update({ voice: e.target.value })}>
            <option value="">{t("ra_default")}</option>
            {mine.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            {others.length > 0 && <optgroup label={t("ra_other")}>{others.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</optgroup>}
          </select>
        </label>
        {lang === "sw" && voices.length > 0 && mine.length === 0 && <p className="muted small ra-wide">{t("ra_novoice")}</p>}
        <Slider label={t("ra_speed")} value={p.rate} min={0.5} max={2} step={0.05} show={fmt} onChange={(v) => update({ rate: v })} />
        <Slider label={t("ra_pitch")} value={p.pitch} min={0.5} max={1.5} step={0.1} show={(v) => v.toFixed(1)} onChange={(v) => update({ pitch: v })} />
        <Slider label={t("ra_volume")} value={p.volume} min={0.2} max={1} step={0.1} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ volume: v })} />
        <div className="ra-field ra-wide ra-sw">
          <label className="switch"><input type="checkbox" checked={p.auto ?? !!user?.accessibility.read_aloud} onChange={(e) => update({ auto: e.target.checked })} /> {t("ra_auto")}</label>
          {sw("options", t("ra_opts"))}{sw("marks", t("ra_marks"))}{sw("highlight", t("ra_hl"))}
        </div>
      </div>
      <div className="row fb-actions">
        <button type="button" className="btn" onClick={test}>▶ {t("ra_test")}</button>
        <button type="button" className="btn ghost" onClick={() => { reset(); }}>↺ {t("ra_reset")}</button>
        <span className="grow" /><Done />
      </div>
    </Modal>
  );
}
function CloseX() {
  const close = useModalClose();
  return <button type="button" className="fit-x" aria-label="Close" onClick={close}>✕</button>;
}
