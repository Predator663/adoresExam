"use client";
import { useEffect, useState } from "react";
import Listen from "@/components/Listen";
import QuestionView, { hasAnswer, initialValue } from "@/components/QuestionView";
import { Bar, Confetti } from "@/components/ui";
import { describe } from "@/lib/answers";
import { fractionCorrect, presentQuestion, type PackQuestion } from "@/lib/marking";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";

/** Retry a set of questions (my mistakes / saved ones). The phone marks them with the same rules as the server.
 *  Learning only: nothing is sent, so no XP, no streak and no marks. */
export default function StudyQuiz({ cards, onExit }: { cards: PackQuestion[]; onExit: () => void }) {
  const { t } = useSession();
  const [i, setI] = useState(0), [shown, setShown] = useState<Question>(), [v, setV] = useState<any>(), [err, setErr] = useState("");
  const [fb, setFb] = useState<{ fraction: number; correct: boolean } | null>(null), [score, setScore] = useState(0), [full, setFull] = useState(0), [finished, setFinished] = useState(false);
  const show = (q: PackQuestion) => { const p = presentQuestion(q); setShown(p); setV(initialValue(p)); };
  useEffect(() => { if (cards.length) show(cards[0]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cards.length || !shown) return <div className="card"><p className="muted">{t("loading")}</p></div>;
  const cur = cards[i];

  function check() {
    if (!hasAnswer(shown!, v)) return setErr(t("answer_first"));
    setErr("");
    const f = fractionCorrect(cur.type, cur.answer, v);
    setScore((s) => s + f); if (f >= 0.9999) setFull((n) => n + 1);
    setFb({ fraction: f, correct: f >= 0.9999 });
  }
  function next() {
    setFb(null);
    if (i + 1 >= cards.length) return setFinished(true);
    setI(i + 1); show(cards[i + 1]);
  }
  if (finished) {
    return (
      <div className="card hero center pop">
        {score / cards.length >= 0.7 && <Confetti />}
        <span className="big-num" aria-hidden>🌟</span><h1>{t("retry_done")}</h1>
        <p>{t("retry_score", { a: full, b: cards.length })} · {Math.round((score / cards.length) * 100)}%</p>
        <p className="small">{t("retry_note")}</p>
        <button className="btn big" style={{ color: "var(--text)" }} onClick={onExit}>{t("back")}</button>
      </div>
    );
  }
  if (fb) {
    return (
      <div className="card slide-in">
        <h2 className={fb.correct ? "ok" : "no"}>{fb.correct ? "✓" : fb.fraction > 0 ? "◐" : "✗"} {t(fb.correct ? "pr_correct" : fb.fraction > 0 ? "pr_partly" : "pr_wrong")}</h2>
        {!fb.correct && <p><b>{t("correct_answer")}:</b> {describe(cur.type, cur.content, cur.answer, t)}</p>}
        {cur.explanation && <div className="hint"><b>{t("explanation")}:</b> <span dangerouslySetInnerHTML={{ __html: cur.explanation }} /></div>}
        <button className="btn primary big" style={{ marginTop: "1rem" }} onClick={next}>{i + 1 >= cards.length ? t("see_summary") : t("next_question")}</button>
      </div>
    );
  }
  return (
    <div className="card slide-in" key={cur.id}>
      <div className="row"><b className="grow">{t("retry_one")}</b><span className="muted">{t("question_x_of_y", { x: i + 1, y: cards.length })}</span></div>
      <Bar value={(i / cards.length) * 100} label={t("progress")} />
      <QuestionView q={shown} value={v} onChange={(x) => { setV(x); setErr(""); }} />
      <Listen q={shown} />
      {err && <p className="no" role="alert">⚠ {err}</p>}
      <button className="btn primary big" style={{ marginTop: "1rem" }} onClick={check}>{t("check_answer")}</button>
      <p className="muted small">{t("retry_note")}</p>
    </div>
  );
}
