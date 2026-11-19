"use client";
/* "Exam calendar" button with a small menu: a designed PDF timetable (print it, pin it up) and an .ics file that the phone's
   calendar app imports, with reminders. Used by students (their own exams) and by teachers/admins (the exams they manage).
   The server builds both files (exams/calendar_export.py); this only asks for them with the login token. */
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { downloadFile } from "@/lib/api";
import { useSession } from "@/lib/session";
import "./calendar-dl.css";

const TXT = {
  en: { btn: "Exam calendar", title: "Download your exam calendar", pdf: "Stylish PDF timetable", pdfH: "Print it or keep it on your phone", ics: "Add to my phone calendar", icsH: "Google, Apple or Outlook, with reminders",
    busy: "Preparing your calendar…", fail: "We could not download the calendar. Check your connection and try again.", done: "Calendar downloaded." },
  sw: { btn: "Kalenda ya mitihani", title: "Pakua kalenda ya mitihani", pdf: "Ratiba nzuri ya PDF", pdfH: "Ichapishe au ihifadhi kwenye simu", ics: "Weka kwenye kalenda ya simu", icsH: "Google, Apple au Outlook, pamoja na vikumbusho",
    busy: "Inaandaa kalenda yako…", fail: "Hatukuweza kupakua kalenda. Angalia mtandao kisha ujaribu tena.", done: "Kalenda imepakuliwa." },
} as const;

export default function CalendarDownload({ path, query = "", className = "" }: { path: string; query?: string; className?: string }) {
  const { lang } = useSession();
  const tx = TXT[lang === "sw" ? "sw" : "en"];
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<"" | "pdf" | "ics">(""), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function get(kind: "pdf" | "ics") {
    if (busy) return;
    setBusy(kind); setMsg(null);
    try {
      await downloadFile(`${path}?file=${kind}${query ? `&${query}` : ""}`, `exam-calendar-${new Date().toISOString().slice(0, 10)}.${kind}`);
      setMsg({ ok: true, t: tx.done });
    } catch { setMsg({ ok: false, t: tx.fail }); }
    setBusy("");
  }

  return (
    <div className={`cal-dl ${className}`} ref={box}>
      <button type="button" className="btn cal-btn" aria-haspopup="true" aria-expanded={open} onClick={() => { setOpen(!open); setMsg(null); }}>
        <Icon n="calendar" size={18} /><span>{tx.btn}</span><i className="cal-caret" aria-hidden />
      </button>
      {open && (
        <div className="cal-pop" role="menu" aria-label={tx.title}>
          <p className="cal-title">{tx.title}</p>
          <button type="button" role="menuitem" className="cal-item pdf" disabled={!!busy} onClick={() => get("pdf")}>
            <span className="cal-ico" aria-hidden>{busy === "pdf" ? <i className="spinner" /> : <Icon n="download" size={20} />}</span>
            <span className="cal-txt"><b>{tx.pdf}</b><small>{tx.pdfH}</small></span><em>PDF</em>
          </button>
          <button type="button" role="menuitem" className="cal-item ics" disabled={!!busy} onClick={() => get("ics")}>
            <span className="cal-ico" aria-hidden>{busy === "ics" ? <i className="spinner" /> : <Icon n="calendar" size={20} />}</span>
            <span className="cal-txt"><b>{tx.ics}</b><small>{tx.icsH}</small></span><em>.ics</em>
          </button>
          <p className={`cal-msg ${msg ? (msg.ok ? "ok" : "no") : ""}`} role="status" aria-live="polite">{busy ? tx.busy : msg?.t || ""}</p>
        </div>
      )}
    </div>
  );
}
