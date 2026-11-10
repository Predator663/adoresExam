"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";

/** Install-the-app support for teacher and admin accounts. The browser's own install prompt (Chrome, Edge, Samsung Internet, Android) is
 *  captured once (SwRegister keeps it on window.__installPrompt) and fired from a button. iPhone/iPad Safari and browsers without a prompt
 *  get the manual steps. Hidden once the app is installed or opened as an installed app. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const W = () => window as any;
const isStandalone = () => !!window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [evt, setEvt] = useState<InstallEvent | null>(null), [installed, setInstalled] = useState(false), [ios, setIos] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => {
    setEvt(W().__installPrompt || null); setInstalled(isStandalone()); setIos(isIos()); setReady(true);
    const onPrompt = (e: any) => { e.preventDefault(); W().__installPrompt = e; setEvt(e); };
    const onDone = () => { W().__installPrompt = null; setEvt(null); setInstalled(true); };
    window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onDone);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onDone); };
  }, []);
  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!evt) return "unavailable";
    try { await evt.prompt(); const r = await evt.userChoice; W().__installPrompt = null; setEvt(null); return r.outcome; } catch { return "unavailable"; }
  }, [evt]);
  return { ready, canPrompt: !!evt, installed, ios, install };
}

const HIDE_KEY = "amani_install_hide", HIDE_DAYS = 14;
const STEPS_IOS = ["Tap the Share button in Safari (the square with an arrow).", "Scroll down and tap “Add to Home Screen”.", "Tap “Add”, then open the app from your Home Screen."];
const STEPS_OTHER = ["Android (Chrome): tap the ⋮ menu, then “Install app” or “Add to Home screen”.", "Computer (Chrome or Edge): click the install icon at the right of the address bar, or open the menu and choose “Install page as app” (Edge: Apps › Install this site as an app).", "Firefox, and Safari on a Mac, cannot install web apps. Use Chrome or Edge, or just keep the website open."];

/** A dismissible card for the staff dashboard. `who` only changes the wording. */
export function InstallBanner({ who }: { who: "teacher" | "admin" }) {
  const { ready, canPrompt, installed, ios, install } = useInstall();
  const [hidden, setHidden] = useState(true), [steps, setSteps] = useState(false), [done, setDone] = useState(false);
  useEffect(() => { try { const t = Number(localStorage.getItem(HIDE_KEY) || 0); setHidden(t > 0 && Date.now() - t < HIDE_DAYS * 864e5); } catch { setHidden(false); } }, []);
  if (!ready || hidden || (installed && !done)) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(Date.now())); } catch { /* private mode */ } setHidden(true); };
  async function go() {
    if (!canPrompt) return setSteps((s) => !s);
    if ((await install()) === "accepted") setDone(true);
  }
  if (done) return (
    <section className="ia ok" role="status"><span className="ia-ic"><Icon n="check" size={22} /></span>
      <div className="ia-txt"><b>The app is installed</b><p>Open it from your home screen or apps list. You can close this tab.</p></div>
      <button type="button" className="ia-x" aria-label="Close" onClick={() => setDone(false)}><Icon n="x" size={18} /></button></section>
  );
  return (
    <section className="ia" aria-label="Install the app">
      <span className="ia-ic" aria-hidden="true"><Icon n="download" size={22} /></span>
      <div className="ia-txt">
        <b>Install the app on this device</b>
        <p>{who === "admin" ? "Keep the live monitor, anti-cheat alerts and exam scheduling one tap away. It opens in its own window and loads faster."
          : "Open your questions, exams and live monitor straight from your home screen. It opens in its own window and loads faster."}</p>
      </div>
      <div className="ia-act">
        <button type="button" className="btn primary" onClick={go} aria-expanded={canPrompt ? undefined : steps}><Icon n="download" size={16} /> {canPrompt ? "Install app" : steps ? "Hide steps" : "How to install"}</button>
        <button type="button" className="btn ghost" onClick={hide}>Not now</button>
      </div>
      {!canPrompt && (
        <div className={`ia-steps-wrap ${steps ? "open" : ""}`}><div className="ia-steps-in">
          <ol className="ia-steps">{(ios ? STEPS_IOS : STEPS_OTHER).map((s) => <li key={s}>{s}</li>)}</ol>
        </div></div>
      )}
    </section>
  );
}
