"use client";
/* Gets the app onto a student's phone with no hunting for an "Install" button.
   A website CANNOT install itself silently (every browser requires a real tap, for safety), so this does the next best thing:
     - Android / Chrome / Edge / Samsung Internet: the browser's own install dialog opens on the student's FIRST TAP after she logs in
       (that tap is the permission the browser needs). She only has to press "Install".
     - iPhone / iPad (Safari has no install dialog): a small sheet with the three steps appears by itself, once.
   It never interrupts an exam attempt, never shows inside the installed app, and if she says no it waits 2 days, then 7, then 30,
   and gives up after the fourth no. Teachers and admins have their own InstallBanner. */
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { useSession } from "@/lib/session";
import "./auto-install.css";

const KEY = "amani_autoinstall", WAIT_DAYS = [0, 2, 7, 30], DELAY_MS = 4000;
type State = { no: number; t: number; done?: boolean };
const W = () => window as any;
const standalone = () => !!window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const read = (): State => { try { return { no: 0, t: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { no: 0, t: 0 }; } };
const write = (s: State) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: asks again next visit, harmless */ } };
const due = (s: State) => !s.done && s.no < WAIT_DAYS.length && Date.now() - s.t >= WAIT_DAYS[s.no] * 864e5;
const inExam = () => !!document.querySelector(".app.focus");  // the exam screen hides the menus: never pop anything up over it

const TXT = {
  en: { t: "Add the app to your phone", p: "Open your exams from the home screen, like any other app. It also loads faster.", s: ["Tap the Share button in Safari (the square with an arrow).", "Scroll down and tap “Add to Home Screen”.", "Tap “Add”. Then open the app from your home screen."], later: "Maybe later", ok: "Got it" },
  sw: { t: "Weka programu kwenye simu yako", p: "Fungua mitihani yako kutoka skrini ya mwanzo kama programu nyingine. Pia inafunguka haraka zaidi.", s: ["Gusa kitufe cha Share kwenye Safari (mraba wenye mshale).", "Sogeza chini kisha gusa “Add to Home Screen”.", "Gusa “Add”. Kisha fungua programu kutoka skrini ya mwanzo."], later: "Baadaye", ok: "Nimeelewa" },
} as const;

export default function AutoInstall() {
  const { user, lang } = useSession();
  const on = user?.role === "student";
  const [sheet, setSheet] = useState(false);
  const tx = TXT[lang === "sw" ? "sw" : "en"];

  useEffect(() => {
    if (!on || standalone()) return;
    let asked = false, armed = false, closed = false;
    const arm = setTimeout(() => { armed = true; }, DELAY_MS);  // not in the first seconds after login
    const onPrompt = (e: any) => { e.preventDefault(); W().__installPrompt = e; };
    const onDone = () => { write({ ...read(), done: true }); W().__installPrompt = null; closed = true; };
    window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onDone);

    // Android and desktop Chrome/Edge: the first tap after the delay opens the browser's own install dialog
    const tap = async () => {
      const evt = W().__installPrompt;
      if (!armed || asked || closed || !evt || !due(read()) || document.visibilityState !== "visible" || inExam()) return;
      asked = true;
      try {
        await evt.prompt();   // allowed here: we are inside the student's own tap
        const r = await evt.userChoice;
        W().__installPrompt = null;
        const s = read();
        write(r?.outcome === "accepted" ? { ...s, done: true } : { no: s.no + 1, t: Date.now() });
      } catch { asked = false; }
    };
    document.addEventListener("pointerup", tap, { passive: true });

    // iPhone / iPad: no install dialog exists, so show the three steps once
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (isIos()) iosTimer = setTimeout(() => { if (!closed && due(read()) && !inExam() && document.visibilityState === "visible") setSheet(true); }, 6000);

    return () => {
      closed = true; clearTimeout(arm); clearTimeout(iosTimer);
      window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onDone);
      document.removeEventListener("pointerup", tap);
    };
  }, [on]);

  if (!sheet) return null;
  const close = () => { const s = read(); write({ no: s.no + 1, t: Date.now() }); setSheet(false); };
  return (
    <div className="ai-back" role="presentation" onClick={() => close()}>
      <section className="ai-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-t" onClick={(e) => e.stopPropagation()}>
        <span className="ai-ic" aria-hidden><Icon n="download" size={24} /></span>
        <h2 id="ai-t">{tx.t}</h2>
        <p>{tx.p}</p>
        <ol>{tx.s.map((x) => <li key={x}>{x}</li>)}</ol>
        <div className="ai-act"><button type="button" className="btn primary" onClick={() => close()}>{tx.ok}</button><button type="button" className="btn ghost" onClick={() => close()}>{tx.later}</button></div>
      </section>
    </div>
  );
}
