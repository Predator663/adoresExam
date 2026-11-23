"use client";
import { ResultUpdatedChip } from "@/components/ResultUpdated";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import ResultsWaiting from "@/components/ResultsWaiting";
import Icon from "@/components/Icon";
import { Pager, usePaged } from "@/components/Pager";
import { Dash, SubjectChips, type Summary } from "@/components/ResultsDash";
import Shell from "@/components/Shell";
import { GradeMedal, PageSkeleton } from "@/components/student";
import { ErrorNote } from "@/components/ui";
import { useMine } from "@/lib/mine";
import { api, downloadFile } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import { hueOf } from "@/lib/student";
import { useSession } from "@/lib/session";
import { prefetch } from "@/lib/swr";
import "@/components/result-plus.css";

export default function Results() {
  const { t, lang, user } = useSession();
  const [subject, setSubject] = useState(""), [sort, setSort] = useState<"" | "best">(""), [q, setQ] = useState(""), [dq, setDq] = useState(""), [busy, setBusy] = useState(0), [err, setErr] = useState("");
  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(h); }, [q]);  // search as she types, but not on every key
  const pg = usePaged<any>("/results/", { subject, sort, q: dq }, { size: 10, cache: String(user?.id ?? "") });
  const { rows: data, error, loading, reload } = pg;
  const pend = useMine<any[]>("/results/pending/");
  const sum = useMine<Summary>("/results/summary/");
  const warm = (id: number) => { if (user) prefetch(user.id, `/results/${id}/`); };  // the result is already on its way when the card is tapped
  const slip = (id: number) => { setBusy(id); setErr(""); downloadFile(`/results/${id}/slip/?file=pdf`, `result-slip-${id}.pdf`).catch((e) => setErr(e.message)).finally(() => setBusy(0)); };
  const filtered = !!(subject || sort || dq);
  const s = sum.data;
  return (
    <Shell title={t("nav_results")}>
      {pend.data?.map((p) => <ResultsWaiting key={p.attempt_id} attemptId={p.attempt_id} title={`${p.exam} · ${p.subject}`} resultsAt={p.results_at} serverTime={p.server_time} compact />)}
      {s && s.count > 0 && <Dash s={s} />}
      {s && s.count > 0 && <SubjectChips s={s} value={subject} onPick={setSubject} />}
      {s && s.count > 0 && (
        <div className="rl-tools">
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("rl_search")} aria-label={t("rl_search")} />
          <div className="rl-seg" role="group">
            <button type="button" aria-pressed={sort === ""} onClick={() => setSort("")}>{t("rl_sort_new")}</button>
            <button type="button" aria-pressed={sort === "best"} onClick={() => setSort("best")}>{t("rl_sort_best")}</button>
          </div>
        </div>
      )}
      {err && <p className="no" role="alert">{err}</p>}
      {loading ? <PageSkeleton rows={4} /> : error ? <ErrorNote error={error} retry={reload} /> : !data.length ? (pend.data?.length && !filtered ? null : (
        <div className="card sx-empty rl-empty"><span className="sx-empty-ico" aria-hidden><Icon n="chart" size={26} /></span><p className="muted">{filtered ? t("rl_none") : t("no_results")}</p>
          {filtered && <button type="button" className="btn" onClick={() => { setSubject(""); setSort(""); setQ(""); }}>{t("rl_clear")}</button>}</div>
      )) : (
        <>
          <p className="muted small sx-count-line">{t("results_count", { n: pg.count })}</p>
          <div ref={pg.top} className="paged rl-list" aria-busy={pg.busy || undefined}>
            {data.map((r, i) => (
              <article key={r.attempt_id} className="card rl-card" data-busy={busy === r.attempt_id ? "" : undefined} style={{ "--h": hueOf(r.subject), "--i": i } as CSSProperties}>
                <Link href={`/result/?id=${r.attempt_id}`} className="rl-main" onPointerEnter={() => warm(r.attempt_id)} onTouchStart={() => warm(r.attempt_id)} onFocus={() => warm(r.attempt_id)}>
                  <GradeMedal grade={r.grade} size={48} />
                  <span className="rl-mid">
                    <b>{r.exam}</b>
                    <span className="muted small"><span className="sx-subj">{r.subject}</span> · {eatDate(r.date, { day: "numeric", month: "short", year: "numeric" }, lang)}</span>
                    <span className="rl-bar" role="presentation"><i style={{ width: `${Math.max(2, Math.min(100, r.percent))}%` }} /></span>
                    {r.updated && <ResultUpdatedChip previous={r.previous_percent} percent={r.percent} />}
                  </span>
                  <b className="rl-pct">{Math.round(r.percent)}%</b>
                  <Icon n="chevron" size={16} />
                </Link>
                <div className="rl-acts">
                  <Link className="rl-act" href={`/result/?id=${r.attempt_id}&tab=exam`} onPointerEnter={() => warm(r.attempt_id)}><Icon n="file" size={15} /> {t("rl_full")}</Link>
                  <Link className="rl-act" href={`/review/?id=${r.attempt_id}`}><Icon n="check" size={15} /> {t("rl_review")}</Link>
                  <button type="button" className="rl-act" onClick={() => slip(r.attempt_id)} disabled={busy === r.attempt_id}><Icon n="download" size={15} /> {t("rl_slip")}</button>
                </div>
              </article>
            ))}
          </div>
          <Pager {...pg.pager} />
          <Link className="btn" href="/progress/"><Icon n="trend" size={18} /> {t("my_analytics")}</Link>
        </>
      )}
    </Shell>
  );
}
