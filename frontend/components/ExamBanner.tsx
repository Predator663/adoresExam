"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import { clock, eatDate, makeOffset } from "@/lib/clock";
import { hueOf } from "@/lib/student";
import { useSession } from "@/lib/session";
import type { ExamCard } from "@/lib/types";
import { Monogram } from "./student";
import Icon from "./Icon";
import { useNow } from "./ui";

const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(ms));

/** HOME-01/02: days remaining, switching to hours and minutes on the exam day; 'Exam today'; 'Starts in 10 minutes'.
 *  One place decides what an exam card says, so the big "next up" card and the small cards never disagree. */
export function examStatus(c: ExamCard, n: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const start = new Date(c.start_at).getTime(), end = new Date(c.end_at).getTime();
  const diff = start - n, today = dayKey(n) === dayKey(start);
  let head = "", big = "", tone: "live" | "soon" | "calm" | "done" | "missed" = "calm";
  if (c.state === "done") { head = t("exam_done"); tone = "done"; }
  else if (c.retake && c.state === "open") { head = t("exam_retake_allowed"); tone = "live"; }  // an administrator allowed her to sit it
  else if (c.state === "missed" || n > end) { head = t("exam_missed"); tone = "missed"; }
  else if (c.state === "in_progress") { head = t("exam_in_progress"); tone = "live"; }
  else if (diff <= 0) { head = t("exam_open_now"); tone = "live"; }
  else if (diff <= 10 * 60_000) { head = t("starts_in_10"); big = clock(diff); tone = "soon"; }
  else if (today) { head = t("exam_today"); big = clock(diff); tone = "soon"; }
  else { const d = Math.ceil(diff / 86_400_000); head = d === 1 ? t("tomorrow") : t("days_to_go", { n: d }); big = ""; }
  const go = c.state === "in_progress" || c.state === "open" || (c.state === "upcoming" && today);
  return { head, big, tone, go, today, diff };
}

export function ExamMeta({ c }: { c: ExamCard }) {
  const { t } = useSession();
  return (
    <ul className="sx-meta">
      <li><Icon n="clock" size={15} />{c.duration_minutes} {t("minutes")}</li>
      <li><Icon n="file" size={15} />{c.question_count} {t("questions")}</li>
      <li><Icon n="target" size={15} />{c.total_marks} {t("total_marks")}</li>
    </ul>
  );
}

/** The one exam that matters most right now: big, with the countdown and a single clear button. */
export function NextUp({ card }: { card: ExamCard }) {
  const { t, lang } = useSession();
  const now = useNow(1000);
  const n = now + makeOffset(card.server_time);  // server time, not the phone's clock (BR-03)
  const s = examStatus(card, n, t);
  const days = Math.max(1, Math.ceil(s.diff / 86_400_000));
  return (
    <section className={`sx-next tone-${s.tone}`} style={{ "--h": hueOf(card.subject) } as CSSProperties} aria-label={t("next_up")}>
      <div className="sx-next-top">
        <span className="sx-eyebrow">{s.tone === "live" ? <><i className="sx-dot" aria-hidden />{t("live_now")}</> : t("next_up")}</span>
        <span className="sx-next-sub">{card.subject}</span>
      </div>
      <h2 className="sx-next-title">{card.title}</h2>
      <p className="sx-next-when">{eatDate(card.start_at, undefined, lang)}</p>
      <ExamMeta c={card} />
      <div className="sx-next-foot">
        <div className="sx-count" aria-live="off">
          {s.big ? <span className="sx-count-num" role="timer">{s.big}</span> : s.tone === "live" ? <span className="sx-count-word">{s.head}</span> : (days === 1 ? <span className="sx-count-word">{t("tomorrow")}</span> : <><span className="sx-count-num">{days}</span><span className="sx-count-unit">{t("days_left_unit")}</span></>)}
          {s.big && <span className="sx-count-unit">{s.head}</span>}
        </div>
        {s.go
          ? <Link className="btn primary big sx-cta" href={`/exam/?id=${card.id}`}>{card.state === "in_progress" ? t("continue_exam") : t("open_exam")}<Icon n="arrow" size={18} /></Link>
          : <Link className="btn sx-cta" href={`/exam/?id=${card.id}`}>{t("see_details")}</Link>}
      </div>
    </section>
  );
}

/** A list of smaller exam cards (upcoming, other live exams). */
export default function ExamBanner({ cards, label }: { cards: ExamCard[]; label?: string }) {
  const { t, lang } = useSession();
  const now = useNow(1000);
  if (!cards.length) return <div className="card"><p className="muted">{t("no_upcoming")}</p></div>;
  const n = now + makeOffset(cards[0].server_time);
  return (
    <div className="snap sx-xlist" role="list" aria-label={label || t("upcoming_exams")}>
      {cards.map((c) => {
        const s = examStatus(c, n, t);
        return (
          <div key={c.id} className={`card sx-xcard tone-${s.tone}`} role="listitem" style={{ "--h": hueOf(c.subject) } as CSSProperties}>
            <div className="sx-xhead">
              <Monogram name={c.subject} size={42} />
              <div className="grow"><p className="sx-xsub">{c.subject}</p><h3 className="sx-xtitle">{c.title}</h3></div>
            </div>
            <p className="muted small sx-xwhen">{eatDate(c.start_at, undefined, lang)}</p>
            <ExamMeta c={c} />
            <div className="sx-xfoot">
              <span className={`sx-status tone-${s.tone}`}>{s.big ? <b className="sx-status-num">{s.big}</b> : null}{s.head}</span>
              {s.go && <Link className="btn primary" href={`/exam/?id=${c.id}`}>{c.state === "in_progress" ? t("continue_exam") : t("open_exam")}</Link>}
              {!s.go && c.state === "upcoming" && <Link className="btn" href={`/exam/?id=${c.id}`}>{t("see_details")}</Link>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
