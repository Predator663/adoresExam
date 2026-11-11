"use client";
import Link from "next/link";
import { useState } from "react";
import { Pager, useClientPage } from "@/components/Pager";
import { RichHtml } from "@/components/Rich";
import Shell from "@/components/Shell";
import StudyQuiz from "@/components/StudyQuiz";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/answers";
import type { PackQuestion } from "@/lib/marking";
import { useSession } from "@/lib/session";

type Card = PackQuestion & { key: string; exam: string; subject: string; attempt_id: number; number: number; your_response: any; skipped: boolean; id: number; saved_id?: number };

/** My mistakes (derived from published results) and the questions I saved from my reviews, with "retry" for either. */
function List({ cards, empty, onRetry, onRemove }: { cards: Card[]; empty: string; onRetry: (c: Card[]) => void; onRemove?: (c: Card) => void }) {
  const { t } = useSession();
  const pg = useClientPage(cards, 10);
  if (!cards.length) return <div className="card"><p className="muted">{empty}</p></div>;
  return (
    <>
      <button className="btn primary big" onClick={() => onRetry(cards)}>🔁 {t("retry_all", { n: cards.length })}</button>
      <div ref={pg.top}>{pg.rows.map((c) => (
        <article key={c.key} className="card">
          <p className="small muted">{c.subject} · {t("from_exam", { exam: c.exam })} · {t("question_n", { n: c.number })}</p>
          <RichHtml html={c.prompt} className="prompt" />
          <p className="no">✗ {t("your_answer")}: {c.skipped ? t("skipped") : describe(c.type, c.content, c.your_response, t)}</p>
          <p><b>{t("correct_answer")}:</b> {describe(c.type, c.content, c.answer, t)}</p>
          {c.explanation && <div className="hint"><b>{t("explanation")}:</b> <RichHtml html={c.explanation} /></div>}
          <div className="row" style={{ gap: ".6rem", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => onRetry([c])}>🔁 {t("retry_one")}</button>
            {onRemove && <button className="btn ghost" onClick={() => onRemove(c)}>✕ {t("unsave")}</button>}
          </div>
        </article>
      ))}</div>
      <Pager {...pg.pager} />
    </>
  );
}

export default function SavedPage() {
  const { t } = useSession();
  const [tab, setTab] = useState<"mistakes" | "saved">("mistakes"), [quiz, setQuiz] = useState<Card[] | null>(null);
  const mistakes = useLoad(() => api<Card[]>("/me/mistakes/")), saved = useLoad(() => api<any[]>("/me/saved/"));
  const asCards = (rows: any[] | null | undefined): Card[] => (rows || []).map((r, i) => ({ ...r, id: i + 1, saved_id: r.id }));
  const remove = async (c: Card) => { try { await api(`/me/saved/${c.saved_id}/`, { method: "DELETE" }); saved.reload(); } catch { /* try again */ } };
  const cur = tab === "mistakes" ? mistakes : saved;
  return (
    <Shell title={t("saved_title")}>
      {quiz ? <StudyQuiz cards={quiz.map((c, i) => ({ ...c, id: i + 1 }))} onExit={() => setQuiz(null)} /> : (
        <>
          <div className="seg" role="tablist">
            {([["mistakes", t("tab_mistakes"), mistakes.data?.length], ["saved", t("tab_saved"), saved.data?.length]] as const).map(([k, l, n]) =>
              <button key={k} role="tab" type="button" className={tab === k ? "on" : ""} aria-selected={tab === k} onClick={() => setTab(k)}>{l}{n ? ` (${n})` : ""}</button>)}
          </div>
          <p className="muted">{tab === "mistakes" ? t("mistakes_intro") : t("saved_intro")}</p>
          {cur.loading ? <Loading /> : cur.error ? <ErrorNote error={cur.error} retry={cur.reload} /> :
            tab === "mistakes" ? <List cards={asCards(mistakes.data)} empty={t("retry_none")} onRetry={setQuiz} />
              : <List cards={asCards(saved.data)} empty={t("saved_none")} onRetry={setQuiz} onRemove={remove} />}
          <p><Link className="btn" href="/results/">← {t("nav_results")}</Link></p>
        </>
      )}
    </Shell>
  );
}
