"use client";
/* Screenshot and screen-recording protection for STUDENTS, switched by an administrator (Settings > Anti-cheat > Screen capture).
   off = nothing happens.  exams = only on the exam and answer-review screens.  all = every screen.

   What a web page CAN do, and this does: cover and blur the whole screen (a) whenever the page loses focus or is hidden (a screenshot tool,
   a recording overlay, the notification shade or the app switcher taking its picture), (b) on Print Screen, the usual screenshot shortcuts
   and printing, and it tries to empty the clipboard after Print Screen. Each attempt it can see is reported to the school (audit log) and
   shows in Login activity > Engagement as a note for a person to read.
   What no web page can do: stop the phone's own screenshot button or a hardware recorder. A browser has no switch for that. (A native
   Android app can; ask the developer to set FLAG_SECURE in the wrapper if you need it.) */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import "./screenguard.css";

type Mode = "off" | "exams" | "all";
const TXT = {
  en: { t: "Protected screen", b: "The content is hidden while the screen could be captured. Return to the app to continue." },
  sw: { t: "Skrini imelindwa", b: "Maudhui yamefichwa wakati skrini inaweza kunakiliwa. Rudi kwenye programu kuendelea." },
};
const EXAM_PATHS = ["/exam", "/review"];

export default function ScreenGuard() {
  const { user, lang } = useSession(), path = usePathname() || "/";
  const [mode, setMode] = useState<Mode>("off"), [covered, setCovered] = useState(false);
  const holdUntil = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), lastLog = useRef(0), pathRef = useRef(path);
  pathRef.current = path;
  const d = TXT[lang === "sw" ? "sw" : "en"];
  const student = user?.role === "student";
  const on = student && (mode === "all" || (mode === "exams" && EXAM_PATHS.some((p) => path.startsWith(p))));

  // the setting: read now, when she comes back to the app, and every 5 minutes
  useEffect(() => {
    if (!student) return;
    const load = () => api<{ screen_protection?: Mode }>("/settings/").then((s) => setMode(s.screen_protection === "all" || s.screen_protection === "exams" ? s.screen_protection : "off")).catch(() => {});
    load();
    const i = setInterval(load, 300_000);
    document.addEventListener("visibilitychange", load);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", load); };
  }, [student]);

  const hold = useCallback((ms: number) => {   // keep the cover on for ms, even if she returns at once
    holdUntil.current = Date.now() + ms; setCovered(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (document.hasFocus() && !document.hidden) setCovered(false); }, ms);
  }, []);
  const report = useCallback((kind: string) => {
    if (Date.now() - lastLog.current < 5000) return;
    lastLog.current = Date.now();
    api("/screen-guard/", { body: { kind, path: pathRef.current } }).catch(() => {});
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!on) { root.classList.remove("sg-on"); setCovered(false); return; }
    root.classList.add("sg-on");
    const away = () => setCovered(true);
    const back = () => { if (Date.now() >= holdUntil.current && !document.hidden) setCovered(false); };
    const vis = () => (document.hidden ? away() : back());
    const caught = (kind: string) => { hold(2500); report(kind); };
    const key = (e: KeyboardEvent) => {
      const k = e.key, low = k.toLowerCase();
      if (k === "PrintScreen" || k === "Snapshot") { try { navigator.clipboard?.writeText(" ")?.catch(() => {}); } catch { /* not allowed */ } return caught("printscreen"); }
      if (e.metaKey && e.shiftKey && ["3", "4", "5", "s"].includes(low)) return caught("shortcut");   // macOS screenshots, Windows Win+Shift+S
      if (e.metaKey && !e.shiftKey && low === "s") return;
      if ((e.ctrlKey || e.metaKey) && low === "p") { e.preventDefault(); return caught("print"); }
    };
    const print = () => caught("print");
    window.addEventListener("blur", away); window.addEventListener("focus", back); window.addEventListener("pagehide", away); window.addEventListener("pageshow", back);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("keydown", key, true); window.addEventListener("keyup", key, true); window.addEventListener("beforeprint", print);
    if (document.hidden || !document.hasFocus()) away();
    return () => {
      root.classList.remove("sg-on");
      window.removeEventListener("blur", away); window.removeEventListener("focus", back); window.removeEventListener("pagehide", away); window.removeEventListener("pageshow", back);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("keydown", key, true); window.removeEventListener("keyup", key, true); window.removeEventListener("beforeprint", print);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [on, hold, report]);

  useEffect(() => { document.documentElement.classList.toggle("sg-cover", on && covered); return () => document.documentElement.classList.remove("sg-cover"); }, [on, covered]);
  if (!on || !covered) return null;
  return createPortal(   // straight under <body>, so the blur that hides the page does not blur the cover itself
    <div className="sg-cover-box" role="alert" aria-live="assertive" onClick={() => { if (document.hasFocus() && Date.now() >= holdUntil.current) setCovered(false); }}>
      <div className="sg-card"><span aria-hidden>🔒</span><b>{d.t}</b><p>{d.b}</p></div>
    </div>, document.body);
}
