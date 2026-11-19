"use client";
import { useEffect } from "react";
import { useMine } from "@/lib/mine";
import { useSession } from "@/lib/session";
import "./daily.css";

export type DailyStatus = {
  count: number; bonus_xp: number; done_today: boolean; score_percent: number | null; in_progress: boolean; available: boolean;
  streak: { current: number; active_today: boolean; at_risk: boolean };
};
const TXT = {
  en: { title: "Daily Challenge", sub: "{n} questions · +{xp} bonus XP", go: "Start", resume: "Continue", done: "Done today", doneSub: "Scored {p}%. Come back tomorrow!", risk: "Your {n}-day streak ends tonight. One challenge saves it!", none: "No quiz subjects available yet." },
  sw: { title: "Changamoto ya Leo", sub: "Maswali {n} · +XP {xp} za ziada", go: "Anza", resume: "Endelea", done: "Imekamilika leo", doneSub: "Umepata {p}%. Rudi kesho!", risk: "Mfululizo wako wa siku {n} unaisha usiku wa leo. Changamoto moja inauokoa!", none: "Hakuna masomo ya mazoezi bado." },
};
const fill = (s: string, v: Record<string, any>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

/** One short quiz a day on the subject she needs most. Finishing it pays a bonus and keeps the streak alive. */
export default function DailyCard({ onStart, busy }: { onStart: () => void; busy?: boolean }) {
  const { lang } = useSession();
  const d = TXT[(lang as "en" | "sw") === "sw" ? "sw" : "en"];
  const q = useMine<DailyStatus>("/practice/daily/");
  const s = q.data;
  useEffect(() => { const f = () => q.reload(); window.addEventListener("amani:daily", f); return () => window.removeEventListener("amani:daily", f); }, [q.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !s.available && !s.done_today) return null;
  const risk = s.streak.at_risk && !s.done_today && s.streak.current > 0;
  return (
    <div className={`card dc ${s.done_today ? "done" : ""} ${risk ? "risk" : ""}`}>
      <span className="dc-ic" aria-hidden>{s.done_today ? "✅" : "🎯"}</span>
      <div className="dc-t">
        <b>{d.title}</b>
        <small className="muted">{s.done_today ? fill(d.doneSub, { p: Math.round(s.score_percent ?? 0) }) : fill(d.sub, { n: s.count, xp: s.bonus_xp })}</small>
        {risk && <small className="dc-risk" role="status">⏳ {fill(d.risk, { n: s.streak.current })}</small>}
      </div>
      {s.done_today ? <span className="dc-ok">{d.done}</span>
        : <button className="btn primary" disabled={busy} onClick={onStart}>{busy ? "…" : s.in_progress ? d.resume : d.go}</button>}
    </div>
  );
}
