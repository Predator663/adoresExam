"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import "./tournament.css";

type Item = { id: number; title: string; body: string; created_at: string };
const TXT = {
  en: { from: "School announcement", close: "Close", more: "+{n} more announcements", closeLabel: "Close announcement" },
  sw: { from: "Tangazo la shule", close: "Funga", more: "+matangazo {n} mengine", closeLabel: "Funga tangazo" },
};

/** An announcement from the school drops down from the top of the screen, like a tournament challenge, and stays until she closes it.
 *  It is not a notification: nothing is added to the bell. Closing is remembered on the server, so it does not come back on another device.
 *  A waiting challenge goes first (it carries Accept / Decline); never shown during an exam. */
export default function AnnouncementToast() {
  const { user, lang } = useSession(), path = usePathname() || "/";
  const d = TXT[lang === "sw" ? "sw" : "en"];
  const [items, setItems] = useState<Item[]>([]), [leaving, setLeaving] = useState<number | null>(null), [challenge, setChallenge] = useState(false);
  const uid = user?.id, student = user?.role === "student";
  const load = useCallback(() => {
    if (!student || document.visibilityState !== "visible") return;
    api<{ items: Item[] }>("/announcements/active/").then((r) => setItems(r.items)).catch(() => {});
  }, [student]);
  useEffect(() => {
    if (!uid) return;
    load();
    const i = setInterval(load, 120_000);
    document.addEventListener("visibilitychange", load); window.addEventListener("amani:notifications", load);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", load); window.removeEventListener("amani:notifications", load); };
  }, [uid, load]);
  useEffect(() => {   // the challenge pop-up marks <html data-tn-pop> while it is on screen
    const el = document.documentElement, read = () => setChallenge(el.hasAttribute("data-tn-pop"));
    read(); const m = new MutationObserver(read); m.observe(el, { attributes: true, attributeFilter: ["data-tn-pop"] });
    return () => m.disconnect();
  }, []);
  const close = (id: number) => {
    setLeaving(id);
    api(`/announcements/${id}/dismiss/`, { body: {} }).catch(() => {});
    setTimeout(() => { setItems((x) => x.filter((i) => i.id !== id)); setLeaving(null); }, 320);
  };
  const hide = path.startsWith("/exam") || path.startsWith("/login");
  const a = items[0];
  if (!student || hide || challenge || !a) return null;
  return (
    <div className={`an-pop${leaving === a.id ? " out" : ""}`} role="region" aria-live="polite" aria-label={`${d.from}: ${a.title}`}>
      <div className="an-pop-in">
        <span className="an-ico" aria-hidden>📢</span>
        <div className="an-text">
          <small className="an-from">{d.from}{items.length > 1 ? ` · ${d.more.replace("{n}", String(items.length - 1))}` : ""}</small>
          <b>{a.title}</b>
          <span className="an-body">{a.body}</span>
        </div>
        <button type="button" className="an-x" onClick={() => close(a.id)} aria-label={d.closeLabel}>✕<span className="sr-only"> {d.close}</span></button>
      </div>
    </div>
  );
}
