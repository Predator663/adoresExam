"use client";
/* A student's result that was re-marked after an administrator corrected a wrong answer key (server: exams/corrections.py).
   The banner says what it was, what it is now and why; the chip marks it in the results list. English and Swahili. */
import { eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";
import "./result-updated.css";

const TXT = {
  en: { title: "Your result was updated", body: "A question in this exam was corrected, so your paper was marked again.", was: "Before", now: "Now", why: "Why", q: "question", on: "Updated", chip: "Updated", grade: "grade" },
  sw: { title: "Matokeo yako yamesasishwa", body: "Swali moja katika mtihani huu lilirekebishwa, kwa hiyo karatasi yako ilisahihishwa upya.", was: "Awali", now: "Sasa", why: "Sababu", q: "swali", on: "Imesasishwa", chip: "Imesasishwa", grade: "daraja" },
} as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function ResultUpdatedBanner({ updated, percent, grade }: { updated: any; percent: number; grade: string }) {
  const { lang } = useSession();
  const tx = TXT[lang === "sw" ? "sw" : "en"];
  if (!updated) return null;
  const p = updated.previous || {}, up = percent >= (p.percent ?? percent);
  return (
    <section className={`ru ${up ? "ru-up" : "ru-down"}`} role="status" aria-live="polite">
      <span className="ru-ic" aria-hidden>{up ? "▲" : "▼"}</span>
      <div className="ru-body">
        <b>{tx.title}</b>
        <p>{tx.body}</p>
        <p className="ru-nums"><span>{tx.was}: <b>{r1(p.percent ?? 0)}%</b> ({tx.grade} {p.grade})</span><i aria-hidden>→</i><span>{tx.now}: <b>{r1(percent)}%</b> ({tx.grade} {grade})</span></p>
        {updated.reason && <p className="ru-why">{tx.why}{updated.question_number ? ` (${tx.q} ${updated.question_number})` : ""}: “{updated.reason}”</p>}
        {updated.at && <small>{tx.on} {eatDate(updated.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, lang)}</small>}
      </div>
    </section>
  );
}

export function ResultUpdatedChip({ previous, percent }: { previous?: number | null; percent: number }) {
  const { lang } = useSession();
  const tx = TXT[lang === "sw" ? "sw" : "en"];
  return <span className="ru-chip" title={previous != null ? `${r1(previous)}% → ${r1(percent)}%` : undefined}>↻ {tx.chip}{previous != null ? ` · ${r1(previous)}% → ${r1(percent)}%` : ""}</span>;
}
