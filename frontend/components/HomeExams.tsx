"use client";
import Link from "next/link";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { examStatus } from "@/components/ExamBanner";
import Icon from "@/components/Icon";
import { Monogram } from "@/components/student";
import { useNow } from "@/components/ui";
import { eatDate, makeOffset, pad } from "@/lib/clock";
import { hueOf } from "@/lib/student";
import { useSession } from "@/lib/session";
import type { ExamCard } from "@/lib/types";

/** Student home, exams part: the one exam that matters now (big, with a ticking countdown), a "coming up" list whose cards
 *  load as she scrolls (first a few, then more with soft placeholders), and a short list of earlier exams.
 *  Everything is driven by the server clock (BR-03), never by the phone's clock alone. */

const L = {
  en: { coming: "Coming up", all: "All", today: "Today", week: "This week", live: "Live now", more: "Loading more exams…", showMore: "Show more", of: "of", none: "No exam matches this filter.", noneBtn: "Show all",
        rules: "Exam rules", opens: "Opens", closes: "Closes", window: "Exam window", left: "left", d: "days", h: "hours", m: "min", s: "sec", retake: "Retake allowed", openIn: "Opens in", closesIn: "Closes in", earlier: "Earlier exams", open: "Open", missed: "Missed", done: "Done", clickRes: "See result", range: "Time", dur: "Duration", q: "Questions", marks: "Marks" },
  sw: { coming: "Inayokuja", all: "Yote", today: "Leo", week: "Wiki hii", live: "Sasa hivi", more: "Inapakia mitihani zaidi…", showMore: "Onyesha zaidi", of: "kati ya", none: "Hakuna mtihani unaolingana na kichujio hiki.", noneBtn: "Onyesha yote",
        rules: "Kanuni za mtihani", opens: "Unafunguka", closes: "Unafungwa", window: "Muda wa mtihani", left: "zimebaki", d: "siku", h: "saa", m: "dak", s: "sek", retake: "Unaruhusiwa kurudia", openIn: "Unafunguka baada ya", closesIn: "Unafungwa baada ya", earlier: "Mitihani ya awali", open: "Fungua", missed: "Haukufanywa", done: "Imekamilika", clickRes: "Tazama matokeo", range: "Muda", dur: "Urefu", q: "Maswali", marks: "Alama" },
};
type Txt = typeof L.en;
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(ms));
const ts = (c: ExamCard) => new Date(c.start_at).getTime();
const hue = (c: ExamCard) => ({ "--h": hueOf(c.subject) }) as CSSProperties;
const calmMotion = () => typeof document !== "undefined" && (document.documentElement.classList.contains("reduce-motion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** One ticking number box. The key makes the number "tick" each time it changes. */
function Tick({ v, label, wide }: { v: number; label: string; wide?: boolean }) {
  return <span className={`ux-tk ${wide ? "wide" : ""}`}><b key={v}>{wide ? v : pad(v)}</b><small>{label}</small></span>;
}

/** The big card: the exam that is open now, or the next one. */
export function NextUpCard({ card }: { card: ExamCard }) {
  const { t, lang } = useSession();
  const x = L[lang === "sw" ? "sw" : "en"];
  const now = useNow(1000);
  const n = now + makeOffset(card.server_time);
  const s = examStatus(card, n, t);
  const live = s.tone === "live";
  const p = parts(live ? new Date(card.end_at).getTime() - n : ts(card) - n);
  return (
    <section className={`ux-next tone-${s.tone}`} style={hue(card)} aria-label={t("next_up")}>
      <i className="ux-glow" aria-hidden />
      <div className="ux-next-top">
        <span className="ux-eyebrow">{live ? <><i className="ux-dot" aria-hidden />{t("live_now")}</> : <><Icon n="calendar" size={14} />{t("next_up")}</>}</span>
        <span className="ux-subj"><Monogram name={card.subject} size={22} />{card.subject}</span>
      </div>
      <h2 className="ux-next-title">{card.title}</h2>
      <p className="ux-next-when"><Icon n="clock" size={15} />{eatDate(card.start_at, undefined, lang)}{card.retake && <span className="ux-tag">{x.retake}</span>}</p>
      <div className="ux-count" role="timer" aria-label={live ? x.closesIn : x.openIn}>
        <span className="ux-count-cap">{live ? x.closesIn : x.openIn}</span>
        <div className="ux-ticks">
          {p.d > 0 && <><Tick v={p.d} label={x.d} wide /><span className="ux-colon">:</span></>}
          <Tick v={p.h} label={x.h} /><span className="ux-colon">:</span><Tick v={p.m} label={x.m} /><span className="ux-colon">:</span><Tick v={p.s} label={x.s} />
        </div>
      </div>
      <ul className="ux-facts">
        <li><Icon n="clock" size={16} /><b>{card.duration_minutes}</b>{t("minutes")}</li>
        <li><Icon n="file" size={16} /><b>{card.question_count}</b>{t("questions")}</li>
        <li><Icon n="target" size={16} /><b>{card.total_marks}</b>{t("total_marks")}</li>
      </ul>
      {s.go
        ? <Link className="btn primary big ux-cta" href={`/exam/?id=${card.id}`}>{card.state === "in_progress" ? t("continue_exam") : t("open_exam")}<Icon n="arrow" size={18} /></Link>
        : <Link className="btn ux-cta" href={`/exam/?id=${card.id}`}>{t("see_details")}<Icon n="arrow" size={18} /></Link>}
    </section>
  );
}

/** Ticking countdown + "how close is it" bar for one list card. Only this part re-renders each second. */
function Timer({ c, x }: { c: ExamCard; x: Txt }) {
  const { t, lang } = useSession();
  const now = useNow(1000);
  const n = now + makeOffset(c.server_time);
  const s = examStatus(c, n, t);
  const start = ts(c), end = new Date(c.end_at).getTime();
  const live = s.tone === "live";
  const diff = live ? end - n : start - n;
  const p = parts(diff);
  const pct = live ? Math.max(0, Math.min(100, ((end - n) / Math.max(1, end - start)) * 100)) : Math.max(4, Math.min(100, (1 - diff / (7 * 86_400_000)) * 100));
  const text = p.d > 0 ? `${p.d}${x.d[0]} ${p.h}${x.h[0]}` : p.h > 0 ? `${p.h}${x.h[0]} ${pad(p.m)}${x.m[0]}` : `${pad(p.m)}:${pad(p.s)}`;
  return (
    <div className={`ux-timer tone-${s.tone}`}>
      <div className="ux-timer-row"><span className="ux-pill">{live && <i className="ux-dot" aria-hidden />}{s.head}</span><b className="ux-timer-num" role="timer">{text}</b></div>
      <div className="ux-prox" aria-hidden><i style={{ width: `${pct}%` }} /></div>
      <small className="muted">{live ? `${x.closesIn} ${text}` : s.today ? `${x.openIn} ${text}` : `${x.opens} ${eatDate(c.start_at, { weekday: "long", day: "numeric", month: "long" }, lang)}`}</small>
    </div>
  );
}

function ExamListCard({ c, i, x }: { c: ExamCard; i: number; x: Txt }) {
  const { t, lang } = useSession();
  const [open, setOpen] = useState(false);
  const day = (o: Intl.DateTimeFormatOptions) => eatDate(c.start_at, o, lang);
  const hm: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  const go = c.state === "in_progress" || c.state === "open";
  return (
    <article className="ux-card" style={{ ...hue(c), "--i": i } as CSSProperties}>
      <div className="ux-date" aria-hidden><small>{day({ weekday: "short" })}</small><b>{day({ day: "numeric" })}</b><small>{day({ month: "short" })}</small></div>
      <div className="ux-card-main">
        <p className="ux-csub"><Monogram name={c.subject} size={22} />{c.subject}{c.retake && <span className="ux-tag">{x.retake}</span>}</p>
        <h3 className="ux-ctitle">{c.title}</h3>
        <ul className="ux-chips2">
          <li title={x.range}><Icon n="clock" size={14} />{eatDate(c.start_at, hm, lang)} – {eatDate(c.end_at, hm, lang)}</li>
          <li title={x.dur}><Icon n="zap" size={14} />{c.duration_minutes} {t("minutes")}</li>
          <li title={x.q}><Icon n="file" size={14} />{c.question_count} {t("questions")}</li>
          <li title={x.marks}><Icon n="target" size={14} />{c.total_marks} {t("total_marks")}</li>
        </ul>
        <Timer c={c} x={x} />
        {c.rules_text?.trim() && (
          <div className={`ux-rules ${open ? "open" : ""}`}>
            <button type="button" className="ux-rules-btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="shield" size={15} />{x.rules}<Icon n="chevron" size={15} /></button>
            <div className="ux-rules-body"><div><p>{c.rules_text}</p></div></div>
          </div>
        )}
      </div>
      <div className="ux-card-act">
        <Link className={`btn ${go ? "primary" : ""}`} href={`/exam/?id=${c.id}`}>{go ? (c.state === "in_progress" ? t("continue_exam") : t("open_exam")) : t("see_details")}<Icon n="arrow" size={16} /></Link>
      </div>
    </article>
  );
}

/** Show a few items, add more when the end of the list scrolls near the screen (with soft placeholders while it "loads"). */
function useLazy(total: number, step: number, resetKey: string) {
  const [n, setN] = useState(step), [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), guard = useRef(false);
  useEffect(() => { setN(step); setBusy(false); guard.current = false; }, [resetKey, step]);
  const more = n < total;
  const grow = useCallback(() => { setN((v) => Math.min(total, v + step)); setBusy(false); guard.current = false; }, [total, step]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    if (typeof IntersectionObserver === "undefined") { setN(total); return; }
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting) || guard.current) return;
      guard.current = true; setBusy(true);
      timer.current = setTimeout(grow, calmMotion() ? 0 : 420);
    }, { rootMargin: "260px 0px" });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer.current); guard.current = false; };
  }, [more, n, total, grow]);
  return { shown: Math.min(n, total), busy, more, sentinel, all: () => setN(total) };
}

function CardSkel({ i }: { i: number }) {
  return (
    <div className="ux-card ux-card-skel" style={{ "--i": i } as CSSProperties} aria-hidden>
      <span className="ux-sk" style={{ height: 76, borderRadius: 16 }} />
      <div className="ux-sk-col"><span className="ux-sk" style={{ height: 12, width: "35%" }} /><span className="ux-sk" style={{ height: 20, width: "75%" }} /><span className="ux-sk" style={{ height: 14, width: "90%" }} /><span className="ux-sk" style={{ height: 44, borderRadius: 14 }} /></div>
    </div>
  );
}

export function ExamsSkeleton() {
  return (
    <div className="ux-skel-wrap" aria-busy="true" aria-live="polite">
      <div className="ux-next ux-next-skel" aria-hidden><span className="ux-sk" style={{ height: 14, width: "30%" }} /><span className="ux-sk" style={{ height: 28, width: "70%", marginTop: 12 }} /><span className="ux-sk" style={{ height: 70, marginTop: 16, borderRadius: 16 }} /><span className="ux-sk" style={{ height: 50, marginTop: 16, borderRadius: 14 }} /></div>
      <CardSkel i={0} /><CardSkel i={1} />
    </div>
  );
}

export default function HomeExams({ cards }: { cards: ExamCard[] }) {
  const { t, lang } = useSession();
  const x = L[lang === "sw" ? "sw" : "en"];
  const now = useNow(30_000);
  const live = useMemo(() => cards.filter((c) => c.state === "in_progress" || c.state === "open").sort((a, b) => ts(a) - ts(b)), [cards]);
  const upcoming = useMemo(() => cards.filter((c) => c.state === "upcoming").sort((a, b) => ts(a) - ts(b)), [cards]);
  const earlier = useMemo(() => cards.filter((c) => c.state === "done" || c.state === "missed").sort((a, b) => ts(b) - ts(a)), [cards]);
  const featured = live[0] || upcoming[0];
  const list = useMemo(() => [...live, ...upcoming].filter((c) => c !== featured), [live, upcoming, featured]);
  const n = now + (cards[0] ? makeOffset(cards[0].server_time) : 0);

  const [seg, setSeg] = useState<"all" | "today" | "week">("all");
  const counts = useMemo(() => ({
    all: list.length,
    today: list.filter((c) => c.state !== "upcoming" || dayKey(ts(c)) === dayKey(n)).length,
    week: list.filter((c) => c.state !== "upcoming" || ts(c) - n <= 7 * 86_400_000).length,
  }), [list, n]);
  const shownList = useMemo(() => list.filter((c) => seg === "all" || c.state !== "upcoming" || (seg === "today" ? dayKey(ts(c)) === dayKey(n) : ts(c) - n <= 7 * 86_400_000)), [list, seg, n]);
  const lazy = useLazy(shownList.length, 3, seg + ":" + list.length);
  const ear = useLazy(earlier.length, 4, "earlier:" + earlier.length);

  return (
    <div className="ux-exams">
      {featured ? <NextUpCard card={featured} /> : (
        <div className="ux-empty"><span className="ux-empty-ico" aria-hidden><Icon n="calendar" size={28} /></span><div><b>{t("no_exams_title")}</b><p className="muted small">{t("no_upcoming")}</p></div></div>
      )}

      {list.length > 0 && (
        <section className="ux-sec" aria-label={x.coming}>
          <div className="ux-sec-head">
            <h2>{x.coming} <span className="ux-count-badge">{list.length}</span></h2>
            {list.length > 2 && (
              <div className="ux-seg" role="group" aria-label={x.coming}>
                {(["all", "today", "week"] as const).map((k) => <button key={k} type="button" className={seg === k ? "on" : ""} aria-pressed={seg === k} onClick={() => setSeg(k)}>{x[k]}<i>{counts[k]}</i></button>)}
              </div>
            )}
          </div>
          {!shownList.length ? (
            <div className="ux-none"><p className="muted">{x.none}</p><button type="button" className="btn" onClick={() => setSeg("all")}>{x.noneBtn}</button></div>
          ) : (
            <div className="ux-list" role="list" aria-busy={lazy.busy || undefined}>
              {shownList.slice(0, lazy.shown).map((c, i) => <div role="listitem" key={c.id} className="ux-li"><ExamListCard c={c} i={i % 3} x={x} /></div>)}
              {lazy.busy && Array.from({ length: Math.min(3, shownList.length - lazy.shown) }, (_, i) => <CardSkel key={"s" + i} i={i} />)}
              {lazy.more && (
                <div ref={lazy.sentinel} className="ux-more">
                  <span className="muted small" aria-live="polite">{lazy.busy ? x.more : `${lazy.shown} ${x.of} ${shownList.length}`}</span>
                  <button type="button" className="btn ux-more-btn" onClick={lazy.all}>{x.showMore}</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {earlier.length > 0 && (
        <section className="ux-sec" aria-label={x.earlier}>
          <div className="ux-sec-head"><h2>{x.earlier} <span className="ux-count-badge">{earlier.length}</span></h2></div>
          <ul className="ux-done-list">
            {earlier.slice(0, ear.shown).map((c, i) => {
              const done = c.state === "done";
              const body = (<><Monogram name={c.subject} size={38} /><span className="grow"><b>{c.title}</b><br /><span className="muted small">{c.subject} · {eatDate(c.start_at, { day: "numeric", month: "short" }, lang)}</span></span><span className={`ux-pill ${done ? "ok" : "no"}`}>{done ? x.done : x.missed}</span>{done && c.attempt_id ? <Icon n="chevron" size={16} /> : null}</>);
              return <li key={c.id} style={{ ...hue(c), "--i": i % 4 } as CSSProperties}>{done && c.attempt_id ? <Link className="ux-done-row" href={`/result/?id=${c.attempt_id}`}>{body}</Link> : <div className="ux-done-row">{body}</div>}</li>;
            })}
          </ul>
          {ear.more && <div ref={ear.sentinel} className="ux-more"><button type="button" className="btn" onClick={ear.all}>{x.showMore}</button></div>}
        </section>
      )}
    </div>
  );
}
