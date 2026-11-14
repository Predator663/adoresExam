"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Listen from "@/components/Listen";
import OfflinePlay from "@/components/OfflinePractice";
import QuestionView, { hasAnswer, initialValue } from "@/components/QuestionView";
import Shell from "@/components/Shell";
import { Feedback, Hero, LengthPicker, Segments, Summary, SubjectTile, buzz, usePT } from "@/components/practice";
import Tips from "@/components/Tips";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/answers";
import { listPacks } from "@/lib/offline";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";

type PState = { session_id: number; subject: string; total: number; answered: number; finished: boolean; index?: number; question?: Question; summary?: { questions: number; fully_correct: number; score_percent: number; xp_earned: number } };
type Kind = "right" | "part" | "wrong";

/** SRS 5.5: short self-paced quizzes with instant feedback. They earn XP and keep streaks alive, never exam marks. */
function Play({ initial, onAgain, onExit }: { initial: PState; onAgain: () => void; onExit: () => void }) {
  const { t } = useSession(), { d } = usePT();
  const [s, setS] = useState<PState>(initial), [v, setV] = useState<any>(), [fb, setFb] = useState<any>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Question | undefined>(initial.question);
  const [results, setResults] = useState<(Kind | undefined)[]>([]), [combo, setCombo] = useState(0), [best, setBest] = useState(0), [rewards, setRewards] = useState<any>(null);
  useEffect(() => { if (s.question) setV(initialValue(s.question)); }, [s.question?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [shown?.id, !!fb]);

  async function send() {
    if (!shown || !hasAnswer(shown, v)) { buzz(30); return setErr(t("answer_first")); }
    setErr(""); setBusy(true);
    try {
      const r = await api<{ feedback: any; rewards?: any; next: PState }>(`/practice/${s.session_id}/answer/`, { body: { question_id: shown.id, response: v } });
      const kind: Kind = r.feedback.correct ? "right" : r.feedback.fraction > 0 ? "part" : "wrong";
      const c = r.feedback.correct ? combo + 1 : 0;
      setResults((a) => { const n = [...a]; n[s.answered] = kind; return n; });
      setCombo(c); setBest((b) => Math.max(b, c)); buzz(kind === "right" ? 25 : [40, 40, 40]);
      setFb(r.feedback); setS(r.next); if (r.rewards) setRewards(r.rewards);
      if (r.next.finished) window.dispatchEvent(new Event("amani:notifications"));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  function next() { setFb(null); setShown(s.question); }
  function leave() { if (s.finished || window.confirm(`${d.leave}? ${d.saved}`)) onExit(); }

  if (s.finished && !fb) return <Summary m={s.summary!} rewards={rewards} combo={best} sessionId={s.session_id} onAgain={onAgain} onExit={onExit} />;
  return (
    <div className="pr-play">
      <div className="pr-top">
        <button type="button" className="pr-x" onClick={leave} aria-label={d.leave}>✕</button>
        <span className="pr-top-t"><b>{s.subject}</b><small className="muted">{t("question_x_of_y", { x: Math.min(s.index || s.total, s.total), y: s.total })}</small></span>
        {combo >= 2 && <span className="pr-combo-chip" key={combo}>🔥 {combo}</span>}
      </div>
      <Segments total={s.total} answered={s.answered} results={results} />
      {fb && shown ? (
        <Feedback fb={fb} combo={combo}>
          {!fb.correct && <p><b>{t("correct_answer")}:</b> {describe(shown.type, shown.content, fb.correct_answer, t)}</p>}
          {fb.explanation && <div className="hint"><b>{t("explanation")}:</b> {fb.explanation}</div>}
        </Feedback>
      ) : (
        <div className="card pr-q" key={shown?.id}>
          {shown && <QuestionView q={shown} value={v} onChange={(x) => { setV(x); setErr(""); }} disabled={busy} />}
          {shown && <Listen q={shown} />}
          {err && <p className="no" role="alert">⚠ {err}</p>}
        </div>
      )}
      <div className="pr-actions">
        {fb ? <button className="btn primary big" autoFocus onClick={next}>{s.finished ? d.see : d.next} →</button>
          : <button className="btn primary big" disabled={busy} onClick={send}>{busy ? <><i className="spinner" aria-hidden /> …</> : d.check}</button>}
      </div>
    </div>
  );
}

const WHY: Record<string, string> = { none: "practice_why_none", not_shared: "practice_why_not_shared", in_exams: "practice_why_in_exams", few: "practice_why_few" };

export default function Practice() {
  const { t } = useSession(), { d } = usePT();
  const subs = useLoad(() => api<any[]>("/practice/subjects/"));
  const ov = useLoad(() => api<any>("/practice/overview/"));
  const [game, setGame] = useState<{ st: PState; id: number } | null>(null), [err, setErr] = useState(""), [count, setCount] = useState(10), [busy, setBusy] = useState<number | null>(null);
  const [offline, setOffline] = useState<string | null>(null), [packs, setPacks] = useState<ReturnType<typeof listPacks>>([]), [off, setOff] = useState(false);
  useEffect(() => {
    const sync = () => { setOff(!navigator.onLine); setPacks(listPacks()); };
    sync();
    window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, [subs.loading]);
  async function start(id: number) {
    setErr(""); setBusy(id);
    try { setGame({ st: await api<PState>("/practice/start/", { body: { subject_id: id, count } }), id }); } catch (e: any) { setErr(e.message); }
    setBusy(null);
  }
  const saved = (id: number) => packs.some((p) => p.id === String(id) && !p.expired);
  const usable = packs.filter((p) => !p.expired);
  const noSignal = off || !!subs.error;
  const exit = () => { setGame(null); subs.reload(); ov.reload(); };
  return (
    <Shell title={t("nav_practice")}>
      {offline ? <OfflinePlay packId={offline} count={count} onExit={() => setOffline(null)} /> : game ? (
        <Play key={game.st.session_id} initial={game.st} onAgain={async () => { setGame(null); await start(game.id); }} onExit={exit} />
      ) : (
        <>
          {ov.data && !noSignal && <Hero o={ov.data} />}
          <p className="muted">{t("practice_intro")}</p>
          <p className="row"><Link className="btn" href="/saved/">🔖 {t("my_mistakes_link")}</Link><Link className="btn" href="/badges/">🏅 {d.seeBadges}</Link></p>
          <Tips cats={["study", "phone"]} />
          {!noSignal && <LengthPicker value={count} onChange={setCount} xp={ov.data?.xp_per_quiz ?? 0} />}
          {err && <p className="no" role="alert">⚠ {err}</p>}
          {noSignal && (
            <div className="card">
              <h2>{t("off_practice_title")}</h2>
              {usable.length ? (
                <>
                  <p className="muted small">{t("off_xp_note")}</p>
                  {usable.map((p) => (
                    <div key={p.id} className="row" style={{ margin: ".5rem 0" }}>
                      <span className="grow"><b>{p.entry.name}</b><br /><span className="muted small">{t("off_pack_n", { n: p.entry.count })}</span></span>
                      <button className="btn primary" onClick={() => setOffline(p.id)}>{t("start")}</button>
                    </div>
                  ))}
                </>
              ) : <p className="muted">{t("off_no_pack")}</p>}
            </div>
          )}
          {!noSignal && <h2 className="pr-h">{d.pick}</h2>}
          {subs.loading ? <Loading /> : subs.error ? (off ? null : <ErrorNote error={subs.error} retry={subs.reload} />) : !subs.data?.length ? <div className="card"><p className="muted">{t("practice_none")}</p></div> : (
            <div className="pr-grid">
              {subs.data.map((s, i) => <SubjectTile key={s.id} s={s} i={i} busy={busy === s.id} saved={saved(s.id)} why={!s.can_start && WHY[s.reason] ? t(WHY[s.reason]) : undefined} onStart={() => start(s.id)} />)}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
