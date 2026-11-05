"use client";
import Link from "next/link";
import ResultsWaiting from "@/components/ResultsWaiting";
import Icon from "@/components/Icon";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import { GradeMedal } from "@/components/student";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import { hueOf } from "@/lib/student";
import { useSession } from "@/lib/session";

export default function Results() {
  const { t, lang } = useSession();
  const pg = usePaged<any>("/results/", {}, { size: 10 });
  const { rows: data, error, loading, reload } = pg;
  const pend = useLoad(() => api<any[]>("/results/pending/"));
  return (
    <Shell title={t("nav_results")}>
      {pend.data?.map((p) => <ResultsWaiting key={p.attempt_id} attemptId={p.attempt_id} title={`${p.exam} · ${p.subject}`} resultsAt={p.results_at} serverTime={p.server_time} compact />)}
      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : !data.length ? (pend.data?.length ? null : <div className="card sx-empty"><span className="sx-empty-ico" aria-hidden><Icon n="chart" size={26} /></span><p className="muted">{t("no_results")}</p></div>) : (
        <>
          <p className="muted small sx-count-line">{t("results_count", { n: pg.count })}</p>
          <div ref={pg.top} className="paged sx-rlist" aria-busy={pg.busy || undefined}>
            {data.map((r) => (
              <Link key={r.attempt_id} href={`/result/?id=${r.attempt_id}`} className="card sx-rcard" style={{ ["--h" as any]: hueOf(r.subject) }}>
                <GradeMedal grade={r.grade} size={48} />
                <span className="sx-rmain">
                  <b className="sx-rtitle">{r.exam}</b>
                  <span className="muted small"><span className="sx-subj">{r.subject}</span> · {eatDate(r.date, { day: "numeric", month: "short", year: "numeric" }, lang)}</span>
                  <span className="sx-rbar" role="presentation"><i style={{ width: `${Math.max(2, Math.min(100, r.percent))}%` }} /></span>
                </span>
                <b className="sx-pct">{Math.round(r.percent)}%</b>
                <Icon n="chevron" size={16} />
              </Link>
            ))}
          </div>
          <Pager {...pg.pager} />
          <Link className="btn" href="/progress/"><Icon n="trend" size={18} /> {t("my_analytics")}</Link>
        </>
      )}
    </Shell>
  );
}
