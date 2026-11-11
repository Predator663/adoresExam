"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Pager, useClientPage } from "@/components/Pager";
import Shell from "@/components/Shell";
import { RichHtml } from "@/components/Rich";
import { ErrorNote, Loading, useLoad, useQuery } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/answers";
import { useSession } from "@/lib/session";

/** RES-05: read-only review; also tells the server which questions she has seen (Mistake Master badge, review XP). */
function Review({ id }: { id: number }) {
  const { t } = useSession();
  const { data, error, loading, reload } = useLoad(() => api<any[]>(`/results/${id}/review/`), [id]);
  const pg = useClientPage(data, 10);  // each page of questions is watched as it appears, so the "seen" count still works
  const [toast, setToast] = useState(""), [savedNums, setSavedNums] = useState<Set<number>>(new Set());
  useEffect(() => {  // which questions of THIS exam she already saved
    api<any[]>("/me/saved/").then((rows) => setSavedNums(new Set(rows.filter((r) => r.attempt_id === id).map((r) => r.number)))).catch(() => {});
  }, [id]);
  const save = async (n: number) => {
    try { await api("/me/saved/", { body: { attempt_id: id, number: n } }); setSavedNums((s) => new Set(s).add(n)); }
    catch (e: any) { setToast(e.message || t("saved_limit")); }
  };
  const seen = useRef<Set<number>>(new Set()), timer = useRef<any>(null);

  const report = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await api<any>(`/results/${id}/review/seen/`, { body: { numbers: [...seen.current] } });
        if (r.xp_awarded) { setToast(t("review_xp", { n: r.xp_awarded })); window.dispatchEvent(new Event("amani:notifications")); }
      } catch { /* the review still works offline of rewards */ }
    }, 900);
  };
  useEffect(() => {
    if (!data) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { const n = Number((e.target as HTMLElement).dataset.n); if (!seen.current.has(n)) { seen.current.add(n); report(); } }
    }), { threshold: 0.6 });
    document.querySelectorAll("[data-n]").forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pg.page, pg.pager.size]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} retry={reload} />;
  return (
    <>
      <Link href={`/result/?id=${id}`}>← {t("back")}</Link> · <Link href="/saved/">🔖 {t("my_mistakes_link")}</Link>
      <h1>{t("review_answers")}</h1>
      {toast && <p className="hint pop" role="status">⭐ {toast}</p>}
      <div ref={pg.top}>{pg.rows.map((q) => {
        const full = q.marks_awarded >= q.marks - 1e-9, part = q.marks_awarded > 0 && !full;
        return (
          <article key={q.number} data-n={q.number} className="card">
            <div className="row"><p className="small muted grow">{t("question_n", { n: q.number })} · {q.voided ? t("voided") : `${q.marks_awarded}/${q.marks}`}</p>
              {!q.voided && <button className="btn small" aria-pressed={savedNums.has(q.number)} disabled={savedNums.has(q.number)} onClick={() => save(q.number)}>{savedNums.has(q.number) ? t("saved_q") : t("save_q")}</button>}
            </div>
            <RichHtml html={q.prompt} className="prompt" />
            {q.voided ? <p className="hint">{t("voided_note")}</p> : (
              <>
                <p className={full ? "ok" : "no"}>{full ? "✓" : part ? "◐" : "✗"} {t("your_answer")}: {q.skipped ? t("skipped") : describe(q.type, q.content, q.your_response, t)}</p>
                {!full && <p><b>{t("correct_answer")}:</b> {describe(q.type, q.content, q.correct_answer, t)}</p>}
                {q.explanation && <div className="hint"><b>{t("explanation")}:</b> <RichHtml html={q.explanation} /></div>}
              </>
            )}
          </article>
        );
      })}</div>
      <Pager {...pg.pager} />
    </>
  );
}

export default function ReviewPage() {
  const id = useQuery("id");
  return <Shell>{id ? <Review id={Number(id)} /> : <Loading />}</Shell>;
}
