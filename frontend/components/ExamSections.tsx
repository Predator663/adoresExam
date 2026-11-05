"use client";
import Link from "next/link";
import ExamBanner, { NextUp } from "@/components/ExamBanner";
import Icon from "@/components/Icon";
import { Monogram } from "@/components/student";
import { eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";
import type { ExamCard } from "@/lib/types";

const ts = (c: ExamCard) => new Date(c.start_at).getTime();

/** Student home: the one exam that matters now first (big), then the other live and upcoming exams, then a short list of earlier ones. */
export default function ExamSections({ cards }: { cards: ExamCard[] }) {
  const { t, lang } = useSession();
  const live = cards.filter((c) => c.state === "in_progress" || c.state === "open").sort((a, b) => ts(a) - ts(b));
  const upcoming = cards.filter((c) => c.state === "upcoming").sort((a, b) => ts(a) - ts(b));
  const earlier = cards.filter((c) => c.state === "done" || c.state === "missed").sort((a, b) => ts(b) - ts(a));
  const featured = live[0] || upcoming[0];
  const otherLive = live.filter((c) => c !== featured), otherUp = upcoming.filter((c) => c !== featured);
  return (
    <div className="exam-sections">
      {featured ? <NextUp card={featured} /> : (
        <div className="card sx-empty"><span className="sx-empty-ico" aria-hidden><Icon n="calendar" size={26} /></span><div><b>{t("no_exams_title")}</b><p className="muted small">{t("no_upcoming")}</p></div></div>
      )}
      {otherLive.length > 0 && (<section><h2>{t("exams_live")}</h2><ExamBanner cards={otherLive} label={t("exams_live")} /></section>)}
      {otherUp.length > 0 && (<section><h2>{t("upcoming_exams")}</h2><ExamBanner cards={otherUp} /></section>)}
      {earlier.length > 0 && (
        <section>
          <h2>{t("exams_earlier")}</h2>
          <ul className="list card sx-earlier">
            {earlier.slice(0, 4).map((c) => {
              const done = c.state === "done";
              const body = (<><Monogram name={c.subject} size={36} /><span className="grow"><b>{c.title}</b><br /><span className="muted small">{c.subject} · {eatDate(c.start_at, { day: "numeric", month: "short" }, lang)}</span></span><span className={`pill sx-pill ${done ? "ok" : "no"}`}>{done ? t("exam_done_short") : t("exam_missed_short")}</span></>);
              return <li key={c.id}>{done && c.attempt_id ? <Link className="sx-row" href={`/result/?id=${c.attempt_id}`}>{body}<Icon n="chevron" size={16} /></Link> : <div className="sx-row">{body}</div>}</li>;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
