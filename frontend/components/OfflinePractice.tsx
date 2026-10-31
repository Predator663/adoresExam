"use client";
import { useEffect, useState } from "react";
import Listen from "@/components/Listen";
import QuestionView, { hasAnswer, initialValue } from "@/components/QuestionView";
import { Bar } from "@/components/ui";
import { describe } from "@/lib/answers";
import { fractionCorrect, pickQuestions, presentQuestion, type PackQuestion } from "@/lib/marking";
import { readPack } from "@/lib/offline";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";

/** A practice quiz from a downloaded pack: no signal needed. The phone marks it with the same rules as the server.
 *  It is for learning only: nothing is sent to the server, so no XP, streak or marks. */
export default function OfflinePlay({ packId, count, onExit }: { packId: string; count: number; onExit: () => void }) {
  const { t } = useSession();
  const [qs, setQs] = useState<PackQuestion[] | null>(null), [name, setName] = useState(""), [missing, setMissing] = useState(false);
  const [i, setI] = useState(0), [shown, setShown] = useState<Question>(), [v, setV] = useState<any>();
  const [fb, setFb] = useState<{ fraction: number; correct: boolean; message: string } | null>(null), [err, setErr] = useState("");
  const [score, setScore] = useState(0), [full, setFull] = useState(0), [finished, setFinished] = useState(false);

  const show = (q: PackQuestion) => { const p = presentQuestion(q); setShown(p); setV(initialValue(p)); };
  useEffect(() => {
    readPack(packId).then((p) => {
      if (!p || !p.questions.length) return setMissing(true);
      const picks = pickQuestions(p.questions, count);
      setQs(picks); setName(p.subject); show(picks[0]);
    });
  }, [packId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) return <div className="card"><p className="muted">{t("off_expired")}</p><button className="btn" onClick={onExit}>{t("back")}</button></div>;
  if (!qs || !shown) return <div className="card"><p className="muted">{t("loading")}</p></div>;
  const cur = qs[i];

  function check() {
    if (!hasAnswer(shown!, v)) return setErr(t("answer_first"));
    setErr("");
    const f = fractionCorrect(cur.type, cur.answer, v);
    setScore((s) => s + f); if (f >= 0.9999) setFull((n) => n + 1);
    setFb({ fraction: f, correct: f >= 0.9999, message: t(f >= 0.9999 ? "pr_correct" : f > 0 ? "pr_partly" : "pr_wrong") });
  }
  function next() {
    setFb(null);
    if (i + 1 >= qs!.length) return setFinished(true);
    setI(i + 1); show(qs![i + 1]);
  }

  if (finished) {
    return (
      <div className="card hero center pop">
        <span className="big-num" aria-hidden>🌟</span><h1>{t("practice_done")}</h1>
        <p>{t("practice_score", { a: full, b: qs.length })} · {Math.round((score / qs.length) * 100)}%</p>
        <p className="small">{t("off_xp_note")}</p>
        <button className="btn big" style={{ color: "var(--text)" }} onClick={onExit}>{t("back")}</button>
      </div>
    );
  }
  if (fb) {
    return (
      <div className="card slide-in">
        <h2 className={fb.correct ? "ok" : "no"}>{fb.correct ? "✓" : fb.fraction > 0 ? "◐" : "✗"} {fb.message}</h2>
        {!fb.correct && <p><b>{t("correct_answer")}:</b> {describe(cur.type, cur.content, cur.answer, t)}</p>}
        {cur.explanation && <div className="hint"><b>{t("explanation")}:</b> {cur.explanation}</div>}
        <button className="btn primary big" style={{ marginTop: "1rem" }} onClick={next}>{i + 1 >= qs.length ? t("see_summary") : t("next_question")}</button>
      </div>
    );
  }
  return (
    <div className="card slide-in" key={cur.id}>
      <div className="row"><b className="grow">{name}</b><span className="muted">{t("question_x_of_y", { x: i + 1, y: qs.length })}</span></div>
      <Bar value={(i / qs.length) * 100} label={t("progress")} />
      <QuestionView q={shown} value={v} onChange={(x) => { setV(x); setErr(""); }} />
      <Listen q={shown} />
      {err && <p className="no" role="alert">⚠ {err}</p>}
      <button className="btn primary big" style={{ marginTop: "1rem" }} onClick={check}>{t("check_answer")}</button>
      <p className="muted small">{t("off_xp_note")}</p>
    </div>
  );
}
