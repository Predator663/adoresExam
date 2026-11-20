"use client";
/* Logs which screens a STUDENT opens and for how long, so administrators can see it under Staff > Page visits (server: core/pagevisits.py).
   What leaves the phone: the screen's address inside the app WITHOUT its ?query and #hash, how many seconds ago it was opened and for how
   long it was visible. Time is counted only while the screen is showing. Finished visits wait in a small queue (kept in the browser, so
   nothing is lost offline) and go out in batches: every 30 s, when 10 are waiting, and when the app is hidden or closed.
   It never blocks or slows the app: every failure is swallowed and retried later. Disclosed in the Privacy policy (section 1). */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

type Item = { uid: string; path: string; at: number; seconds: number };
type Cur = { uid: string; path: string; at: number; since: number | null; ms: number };
const KEY = "amani_pv_q", CAP = 200, BATCH = 40;
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const visible = () => document.visibilityState === "visible";

export default function PageTracker() {
  const { user } = useSession();
  const path = usePathname();
  const on = user?.role === "student";
  const uid = user?.id;
  const where = useRef(path), cur = useRef<Cur | null>(null), busy = useRef(false), route = useRef<(() => void) | null>(null);
  where.current = path;

  useEffect(() => {
    if (!on) return;
    const qKey = `${KEY}:${uid}`;
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i) || ""; if (k.startsWith(`${KEY}:`) && k !== qKey) localStorage.removeItem(k); } } catch { /* storage off */ }  // another person's leftovers
    let mem: Item[] | null = null;  // used only while localStorage is unavailable
    const get = (): Item[] => {
      if (mem) return mem;
      try { const q = JSON.parse(localStorage.getItem(qKey) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; }
    };
    const put = (q: Item[]) => { try { localStorage.setItem(qKey, JSON.stringify(q.slice(-CAP))); mem = null; } catch { mem = q.slice(-CAP); } };

    const start = () => { cur.current = { uid: newId(), path: where.current || "/", at: Date.now(), since: visible() ? Date.now() : null, ms: 0 }; };
    const stop = () => {
      const c = cur.current; cur.current = null;
      if (!c) return;
      const seconds = Math.round((c.ms + (c.since ? Date.now() - c.since : 0)) / 1000);
      if (seconds >= 1) put([...get(), { uid: c.uid, path: c.path, at: c.at, seconds }]);  // a flash-by (a redirect) is not a visit
    };
    async function flush(keepalive = false) {
      if (busy.current || navigator.onLine === false) return;
      const batch = get().slice(0, BATCH);
      if (!batch.length) return;
      busy.current = true;
      const now = Date.now();
      try {
        await api("/page-visits/", { method: "POST", keepalive, body: {
          visits: batch.map((b) => ({ uid: b.uid, path: b.path, ago: Math.max(0, Math.round((now - b.at) / 1000)), seconds: b.seconds })),
          standalone: window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true } });
        const sent = new Set(batch.map((b) => b.uid));
        put(get().filter((x) => !sent.has(x.uid)));
      } catch { /* offline, busy or logged out: the queue keeps them for the next try */ }
      busy.current = false;
    }
    const hide = () => { if (!cur.current) return; stop(); flush(true); };   // leaving: count what she saw, send it now
    const vis = () => { if (visible()) { if (!cur.current) start(); } else hide(); };
    route.current = () => {                                                  // a new screen: close the old visit, open the next
      if (cur.current?.path === where.current) return;
      stop(); start();
      if (get().length >= 10) flush();
    };
    const timer = setInterval(() => { if (visible()) flush(); }, 30_000);
    start(); flush();  // whatever was left from last time goes out first
    document.addEventListener("visibilitychange", vis); window.addEventListener("pagehide", hide);
    return () => {
      route.current = null; clearInterval(timer);
      document.removeEventListener("visibilitychange", vis); window.removeEventListener("pagehide", hide);
      stop(); flush(true);
    };
  }, [on, uid]);

  useEffect(() => { route.current?.(); }, [path]);
  return null;
}
