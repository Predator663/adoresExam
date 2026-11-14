"use client";
/* Voice typing for the question editor. It uses the browser's own speech recogniser (Chrome, Edge, Safari: the audio is sent to
   the browser maker's service, so it needs internet and a secure page). Words are put in at the cursor once the engine is sure
   of them; the words it is still working on show in the bar. Nothing is recorded or stored by this school system. */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDictation } from "@/lib/dictation";
import "./voice.css";

const ACCENTS: [string, string][] = [["en-TZ", "Tanzania"], ["en-KE", "Kenya"], ["en-GB", "British"], ["en-US", "American"]];
const KEY = "amani_voice_lang", IDLE_MS = 90_000;
const SR = () => (typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);
const ERR: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Tap the lock or microphone icon in the address bar, allow it, then try again.",
  "service-not-allowed": "The microphone is blocked. Tap the lock or microphone icon in the address bar, allow it, then try again.",
  "audio-capture": "No microphone was found on this device.",
  network: "Voice typing needs an internet connection.",
  "language-not-supported": "This browser cannot listen for that accent. Choose another one.",
};
const stopOthers = "amani:voice-stop";

export function useDictation(o: { insert: (text: string) => void; before: () => string; undo: () => void; oneLine?: boolean }) {
  const [on, setOn] = useState(false), [interim, setInterim] = useState(""), [error, setError] = useState(""), [lang, setLangS] = useState("en-TZ"), [ok, setOk] = useState(false);
  const rec = useRef<any>(null), want = useRef(false), heard = useRef(0), api = useRef(o);
  api.current = o;
  useEffect(() => { setOk(!!SR()); try { const l = localStorage.getItem(KEY); if (l && ACCENTS.some((a) => a[0] === l)) setLangS(l); } catch { /* fine */ } }, []);

  const stop = useCallback(() => { want.current = false; setOn(false); setInterim(""); try { rec.current?.stop(); } catch { /* already stopped */ } }, []);
  const start = useCallback((l: string) => {
    const R = SR(); if (!R) return;
    window.dispatchEvent(new CustomEvent(stopOthers, { detail: rec }));
    setError(""); want.current = true; heard.current = Date.now();
    const r = new R(); rec.current = r;
    r.lang = l; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], said = res[0]?.transcript || "";
        if (!res.isFinal) { live += said; continue; }
        heard.current = Date.now();
        const f = formatDictation(said, api.current.before(), api.current.oneLine);
        if (f.action === "undo") api.current.undo(); else if (f.action === "stop") { stop(); return; } else if (f.text) api.current.insert(f.text);
      }
      if (live) heard.current = Date.now();
      setInterim(live);
    };
    r.onerror = (e: any) => { if (e.error === "no-speech" || e.error === "aborted") return; setError(ERR[e.error] || "Voice typing stopped. Please try again."); want.current = false; };
    r.onend = () => {
      if (want.current) { setTimeout(() => { if (want.current && rec.current === r) { try { r.start(); } catch { /* restart refused */ } } }, 120); return; }  // the browser ends long sessions by itself
      setOn(false); setInterim("");
    };
    try { r.start(); setOn(true); } catch { setError("Could not start the microphone. Please try again."); want.current = false; }
  }, [stop]);

  useEffect(() => {  // one microphone at a time; never left open by mistake
    const other = (e: Event) => { if ((e as CustomEvent).detail !== rec) stop(); };
    const hide = () => { if (document.hidden) stop(); };
    const idle = setInterval(() => { if (want.current && Date.now() - heard.current > IDLE_MS) { stop(); setError("Voice typing stopped after a long silence."); } }, 5000);
    window.addEventListener(stopOthers, other); document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener(stopOthers, other); document.removeEventListener("visibilitychange", hide); clearInterval(idle); want.current = false; try { rec.current?.abort(); } catch { /* gone */ } };
  }, [stop]);

  const setLang = (l: string) => { setLangS(l); try { localStorage.setItem(KEY, l); } catch { /* fine */ } if (want.current) { try { rec.current?.abort(); } catch { /* restarts below */ } setTimeout(() => start(l), 200); } };
  return { ok, on, interim, error, lang, setLang, toggle: () => (on ? stop() : start(lang)), stop };
}

export function VoiceButton({ d, mouseDown }: { d: ReturnType<typeof useDictation>; mouseDown?: (e: React.MouseEvent) => void }) {
  if (!d.ok) return <button type="button" className="btn" disabled title="Voice typing works in Chrome, Edge or Safari" aria-label="Voice typing is not available in this browser"><span className="vd-mic" aria-hidden>🎤</span></button>;
  return (
    <button type="button" className={`btn vd-btn ${d.on ? "on" : ""}`} aria-pressed={d.on} title={d.on ? "Stop voice typing (Alt+M)" : "Type with your voice (Alt+M)"} onMouseDown={mouseDown} onClick={d.toggle}>
      <span className="vd-mic" aria-hidden>🎤</span><span>{d.on ? "Stop" : "Voice"}</span>
    </button>
  );
}

export function VoiceBar({ d }: { d: ReturnType<typeof useDictation> }) {
  if (!d.on && !d.error) return null;
  return (
    <div className={`vd-bar ${d.error ? "err" : ""}`} role="status" aria-live="polite">
      {d.error ? <p className="no" role="alert" style={{ margin: 0 }}>⚠ {d.error}</p> : (
        <div className="vd-live"><span className="vd-wave" aria-hidden><i /><i /><i /><i /><i /></span><span className="vd-text">{d.interim || "Listening… speak clearly."}</span></div>
      )}
      <div className="vd-opts">
        <label className="small muted" htmlFor="vd-accent">Accent</label>
        <select id="vd-accent" className="input" value={d.lang} onChange={(e) => d.setLang(e.target.value)}>{ACCENTS.map(([c, n]) => <option key={c} value={c}>{n} English</option>)}</select>
        <span className="muted vd-hint">Say “full stop”, “comma”, “question mark”, “new line”, “scratch that” or “stop dictation”.</span>
      </div>
    </div>
  );
}
