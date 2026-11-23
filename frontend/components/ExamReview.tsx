"use client";
/* The student's "Full exam" tab: the whole paper as she sat it, with her answers, and a Show answers switch that reveals
   what was right, the correct answers and the explanations. Server: GET /results/<id>/full-exam/ (exams/views.py result_full_exam).
   Only available after her result is out, and only while an administrator has the full-exam review switched on for the exam. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MatchPairs, PartIcon } from "@/components/ReviewParts";
import { ItemContent, RichHtml } from "@/components/Rich";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/answers";
import { blankPart, orderOf, orderPart, verdictOf, rightPart, type Part, type RQ, type Verdict } from "@/lib/review";
import { useSession } from "@/lib/session";
import "./exam-review.css";

type Data = { exam: { title: string; subject: string; duration_minutes: number; score: number; total: number; percent: number; grade: string };
  sections: { letter: string; type: string; title: string; instructions: string }[]; questions: RQ[] };

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const num = (n: number) => String(Math.round(n * 100) / 100);

/** Fades each question in the first time it scrolls into view. */
function useReveal() {
  const ref = useRef<HTMLElement>(null), [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}

/** One answer line: a letter or number, the content, what it was, and a ✓ ◐ ✗. */
function Opt({ k, part, pick, children, tag, keyTag }: { k: string; part: Part; pick: boolean; children: ReactNode; tag?: ReactNode; keyTag?: ReactNode }) {
  return (
    <div className={`rv-opt ${pick ? "pick" : ""} ${part}`}>
      <span className="k">{k}</span>
      <div>{children}{tag ? <span className="tag">{tag}</span> : null}{keyTag ? <span className="tag kt">{keyTag}</span> : null}</div>
      <span className="ic" aria-hidden><PartIcon part={part} /></span>
    </div>
  );
}

function Body({ q, v }: { q: RQ; v: Verdict }) {
  const { t } = useSession();
  const c = q.content || {}, r = q.your_response, key = q.correct_answer;
  const yours = <>{t("your_answer")}</>, right = <>{t("correct_answer")}</>;

  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    const multi = q.type === "mcq_multi";
    const mine = new Set<string>(multi ? (Array.isArray(r) ? r : []) : r ? [r] : []);
    const good = new Set<string>(multi ? key?.correct || [] : [key?.correct]);
    return (
      <div className="rv-opts">{(c.options || []).map((o: any, i: number) => {
        const picked = mine.has(o.id), isKey = good.has(o.id);
        const part: Part = picked && isKey ? rightPart(v) : picked ? "bad" : isKey ? "miss" : "";
        return <Opt key={o.id} k={KEYS[i] || String(i + 1)} part={part} pick={picked} tag={picked ? yours : undefined} keyTag={part === "miss" ? right : undefined}><ItemContent item={o} /></Opt>;
      })}</div>
    );
  }
  if (q.type === "true_false") {
    const val = (x: any) => (typeof x === "object" && x ? x.correct : x), norm = (x: any) => (x === true || x === "true" ? true : x === false || x === "false" ? false : null);
    const mine = norm(val(r)), good = norm(val(key));
    return (
      <div className="rv-opts">{[true, false].map((b) => {
        const picked = mine === b, isKey = good === b;
        const part: Part = picked && isKey ? rightPart(v) : picked ? "bad" : isKey ? "miss" : "";
        return <Opt key={String(b)} k={b ? "T" : "F"} part={part} pick={picked} tag={picked ? yours : undefined} keyTag={part === "miss" ? right : undefined}>{b ? t("true") : t("false")}</Opt>;
      })}</div>
    );
  }
  if (q.type === "matching") return <MatchPairs q={q} />;
  if (q.type === "ordering") {
    const mine = orderOf(r), items: any[] = c.items || [], want = orderOf(key), by = (id?: string) => items.find((x) => x.id === id);
    return (
      <div className="rv-opts">{(mine.length ? mine : []).map((id, i) => {
        const part = orderPart(q, i), fix = by(want[i]);
        return (
          <Opt key={id + i} k={String(i + 1)} part={part} pick tag={undefined}>
            <ItemContent item={by(id) || { text: id }} />
            {part === "bad" && fix && <div className="rv-fix"><div><span className="tag">{t("rv_belongs")}: <b><ItemContent item={fix} /></b></span></div></div>}
          </Opt>
        );
      })}{!mine.length && <p className="rv-ans none">{t("rv_not_answered")}</p>}</div>
    );
  }
  if (q.type === "fill_blank") {
    const ok = v === "full", empty = v === "skip";
    return (
      <>
        <p className={`rv-ans ${empty ? "none" : ok ? "ok" : "bad"}`}>{empty ? t("rv_not_answered") : String(r)}{c.unit ? ` ${c.unit}` : ""}</p>
        <div className="rv-key"><div><p className="rv-keybox"><b className="l">{t("rv_accepted")}:</b> {describe(q.type, c, key, t)}</p></div></div>
      </>
    );
  }
  // fill_multi: the blanks are shown inside the passage; the correct words are listed under it when the answers are on
  return (
    <div className="rv-key"><div><p className="rv-keybox"><b className="l">{t("rv_accepted")}:</b> {describe(q.type, c, key, t)}</p></div></div>
  );
}

function fillPrompt(q: RQ, none: string): string {
  const c = q.content || {}, bank: Record<string, string> = {};
  for (const w of c.bank || []) bank[w.id] = w.text;
  return (q.prompt || "").replace(/\[\[(\d+)\]\]/g, (_m, n) => {
    const i = Number(n) - 1, id = c.blanks?.[i]?.id, got = (q.your_response || {})[id];
    const text = got === undefined || String(got).trim() === "" ? "" : c.mode === "bank" ? bank[got] ?? got : got;
    return `<span class="rv-blank ${blankPart(q, i)}"><sup>${esc(n)}</sup> ${text ? esc(String(text)) : esc(none)}</span>`;
  });
}

function Card({ q, on, saved, onSave }: { q: RQ; on: boolean; saved: boolean; onSave: (n: number) => void }) {
  const { t } = useSession();
  const [ref, seen] = useReveal(), v = verdictOf(q);
  const label = v === "full" ? <>✓ {t("rv_right")}</> : v === "part" ? <><i className="rv-half" /> {t("rv_partly")}</> : v === "skip" ? <>– {t("skipped")}</> : v === "none" ? <>✗ {t("rv_wrong")}</> : null;
  return (
    <article ref={ref as any} id={`rq-${q.number}`} data-n={q.number} className={`rv-q v-${v} ${seen ? "in" : ""}`}>
      <div className="rv-n">{q.number}</div>
      <div className="rv-body">
        <div className="rv-top">
          <span className="rv-marks">{q.voided ? t("voided") : on ? `${num(q.marks_awarded || 0)}/${num(q.marks)}` : q.marks === 1 ? t("mark_one") : t("marks_n", { n: num(q.marks) })}</span>
          <span className="rv-state" aria-live="polite">{label}</span>
          {!q.voided && <button type="button" className="rv-save" aria-pressed={saved} disabled={saved} onClick={() => onSave(q.number)}>{saved ? t("saved_q") : t("save_q")}</button>}
        </div>
        <RichHtml html={q.type === "fill_multi" ? fillPrompt(q, "…") : q.prompt} className="rv-prompt" />
        {q.voided ? <p className="rv-void">{t("voided_note")}</p> : (
          <>
            <Body q={q} v={v} />
            {q.explanation && <div className="rv-key"><div><div className="rv-explain"><b>{t("explanation")}:</b> <RichHtml html={q.explanation} /></div></div></div>}
          </>
        )}
      </div>
    </article>
  );
}

export default function ExamReview({ id }: { id: number }) {
  const { t } = useSession();
  const { data, error, err, loading, reload } = useLoad(() => api<Data>(`/results/${id}/full-exam/`), [id]);
  const [on, setOn] = useState(false), [filter, setFilter] = useState<"all" | Verdict>("all"), [saved, setSaved] = useState<Set<number>>(new Set()), [toast, setToast] = useState("");
  const top = useRef<HTMLDivElement>(null), seen = useRef<Set<number>>(new Set()), timer = useRef<any>(null);

  useEffect(() => { try { setOn(sessionStorage.getItem("rv-key") === "1"); } catch { /* private mode */ } }, []);
  const flip = (v: boolean) => { setOn(v); try { sessionStorage.setItem("rv-key", v ? "1" : "0"); } catch { /* ignore */ } };
  useEffect(() => { api<any[]>("/me/saved/").then((rows) => setSaved(new Set(rows.filter((r) => r.attempt_id === id).map((r) => r.number)))).catch(() => {}); }, [id]);
  const save = async (n: number) => {
    try { await api("/me/saved/", { body: { attempt_id: id, number: n } }); setSaved((s) => new Set(s).add(n)); }
    catch (e: any) { setToast(e.message || t("saved_limit")); }
  };

  // Which questions she has looked at (feeds the Mistake Master badge and the review XP, like the question-by-question review)
  const report = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await api<any>(`/results/${id}/review/seen/`, { body: { numbers: [...seen.current] } });
        if (r.xp_awarded) { setToast(t("review_xp", { n: r.xp_awarded })); window.dispatchEvent(new Event("amani:notifications")); }
      } catch { /* the page still works without rewards */ }
    }, 900);
  };
  useEffect(() => {
    if (!data || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { const n = Number((e.target as HTMLElement).dataset.n); if (!seen.current.has(n)) { seen.current.add(n); report(); } }
    }), { threshold: 0.6 });
    document.querySelectorAll(".rv [data-n]").forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: 0, full: 0, part: 0, none: 0, skip: 0, void: 0 };
    (data?.questions || []).forEach((q) => { m.all++; m[verdictOf(q)]++; });
    return m;
  }, [data]);
  const shown = useMemo(() => (data?.questions || []).filter((q) => filter === "all" || verdictOf(q) === filter), [data, filter]);

  if (loading) return <Loading />;
  if (err?.code === "review_off") return <div className="card rv-lock"><div className="big" aria-hidden>🔒</div><h2>{t("rv_off_title")}</h2><p className="muted">{t("rv_off")}</p></div>;
  if (error || !data) return <ErrorNote error={error} retry={reload} />;

  const jump = (n: number) => {
    if (filter !== "all") setFilter("all");
    setTimeout(() => {
      const el = document.getElementById(`rq-${n}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1300);
    }, filter !== "all" ? 80 : 0);
  };
  const { exam } = data;
  const chips: [("all" | Verdict), string][] = [["all", t("rv_f_all")], ["full", t("rv_f_right")], ["part", t("rv_f_part")], ["none", t("rv_f_wrong")], ["skip", t("rv_f_skip")]];
  const Switch = (
    <button type="button" role="switch" aria-checked={on} className="rv-sw" onClick={() => flip(!on)}>
      <span className="rv-knob" aria-hidden />{t("rv_show_answers")}
    </button>
  );
  return (
    <div className="rv rv-pane" data-key={on ? "1" : "0"} ref={top}>
      <header className="rv-head">
        <h2>{exam.title}</h2>
        <p>{exam.subject} · {t("rv_minutes", { n: exam.duration_minutes })} · {t("rv_questions", { n: counts.all })}</p>
        <span className="rv-score">{t("rv_score")} <b>{num(exam.score)}/{num(exam.total)}</b> · {Math.round(exam.percent)}%</span>
        <div className="rv-toc">{data.sections.map((s) => {
          const first = data.questions.find((q) => q.section === s.letter);
          return <a key={s.letter} href={`#rq-${first?.number}`} onClick={(e) => { e.preventDefault(); if (first) jump(first.number); }}>{t("rv_section", { l: s.letter })}: {s.title}</a>;
        })}</div>
        <div>{Switch}</div>
        <p className="rv-hint">{t("rv_hint")}</p>
        <p className="rv-legend"><span className="o"><b>✓</b> {t("rv_l_ok")}</span><span className="m"><b><i className="rv-half" /></b> {t("rv_l_mid")}</span><span className="b"><b>✗</b> {t("rv_l_bad")}</span></p>
        <div className="rv-nav" role="navigation" aria-label={t("rv_jump")}>{data.questions.map((q) => <button key={q.number} type="button" className={`rv-dot v-${verdictOf(q)}`} onClick={() => jump(q.number)} aria-label={`${t("question_n", { n: q.number })}`}>{q.number}</button>)}</div>
        <div className="rv-filters" role="group" aria-label={t("rv_filter")}>{chips.filter(([k]) => k === "all" || counts[k] > 0).map(([k, label]) => (
          <button key={k} type="button" className="rv-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} <small>{counts[k]}</small></button>))}
        </div>
      </header>
      {toast && <p className="hint" role="status">⭐ {toast}</p>}

      {data.sections.map((s) => {
        const qs = shown.filter((q) => q.section === s.letter);
        if (!qs.length) return null;
        const marks = qs.reduce((a, q) => a + (q.voided ? 0 : q.marks), 0);
        return (
          <section key={s.letter} className="rv-sec">
            <div className="rv-sec-h"><h3>{t("rv_section", { l: s.letter })}</h3><span>{s.title}</span><em>{t("rv_questions", { n: qs.length })} · {t("marks_n", { n: num(marks) })}</em></div>
            <p className="rv-instr">{s.instructions}</p>
            {qs.map((q) => <Card key={q.number} q={q} on={on} saved={saved.has(q.number)} onSave={save} />)}
          </section>
        );
      })}
      {!shown.length && <p className="rv-empty">{t("rv_none_here")}</p>}

      <div className="rv-dock">
        {Switch}
        <span className="rv-count">{shown.length}/{counts.all}</span>
        <button type="button" className="rv-up" aria-label={t("rv_top")} onClick={() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>↑</button>
      </div>
    </div>
  );
}
