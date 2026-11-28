"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DATETIME, eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";
import "./tournament.css";

type Item = { id: number; title: string; reason: string; returned_at: string; returned_by: string };

/** A paper an administrator sent back drops down from the top of the screen for the teacher, with the reason, and stays until she
 *  closes it. Closing is remembered on the server (not on this device), so it does not come back on another phone or computer.
 *  The reason also stays on the exam itself until she submits it again. */
export default function ReturnedExamPopup() {
  const { user, lang } = useSession(), path = usePathname() || "/";
  const [items, setItems] = useState<Item[]>([]), [leaving, setLeaving] = useState<number | null>(null);
  const uid = user?.id, teacher = !!user && user.role === "teacher";
  const load = useCallback(() => {
    if (!teacher || document.visibilityState !== "visible") return;
    api<{ items: Item[] }>("/returned-exams/").then((r) => setItems(r.items)).catch(() => {});
  }, [teacher]);
  useEffect(() => {
    if (!uid) return;
    load();
    const i = setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load); window.addEventListener("amani:notifications", load);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", load); window.removeEventListener("amani:notifications", load); };
  }, [uid, load]);
  const close = (id: number) => {
    setLeaving(id);
    api(`/returned-exams/${id}/dismiss/`, { body: {} }).catch(() => {});
    setTimeout(() => { setItems((x) => x.filter((i) => i.id !== id)); setLeaving(null); }, 320);
  };
  const it = items[0];
  if (!teacher || path.startsWith("/login") || !it) return null;
  return (
    <div className={`an-pop${leaving === it.id ? " out" : ""}`} role="alertdialog" aria-live="assertive" aria-label={`Exam sent back: ${it.title}`}>
      <div className="an-pop-in">
        <span className="an-ico" aria-hidden>↩️</span>
        <div className="an-text">
          <small className="an-from">{lang === "sw" ? "Mtihani umerudishwa" : "Exam sent back"}{it.returned_by ? ` · ${it.returned_by}` : ""} · {eatDate(it.returned_at, DATETIME, lang)}{items.length > 1 ? ` · +${items.length - 1}` : ""}</small>
          <b>{it.title}</b>
          <span className="an-body" style={{ whiteSpace: "pre-wrap" }}>{it.reason}</span>
          <Link className="btn" style={{ marginTop: ".5rem", display: "inline-block" }} href={`/staff/exams/?id=${it.id}`} onClick={() => close(it.id)}>
            {lang === "sw" ? "Fungua mtihani" : "Open the exam to fix it"} →
          </Link>
        </div>
        <button type="button" className="an-x" onClick={() => close(it.id)} aria-label="Close"><span aria-hidden>✕</span></button>
      </div>
    </div>
  );
}
