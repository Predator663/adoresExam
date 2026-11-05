"use client";
import Icon from "@/components/Icon";
import Shell from "@/components/Shell";
import { GradeMedal, Monogram, Spark } from "@/components/student";
import { Bar, ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** RES-04, GRD-02, GRD-03: strengths and weak areas, progress per subject, what to revise, projected division. */
export default function Progress() {
  const { t } = useSession();
  const a = useLoad(() => api<any>("/student/analytics/"));
  if (a.loading) return <Shell title={t("my_analytics")}><Loading /></Shell>;
  if (a.error || !a.data) return <Shell title={t("my_analytics")}><ErrorNote error={a.error} retry={a.reload} /></Shell>;
  const d = a.data, p = d.projected;
  return (
    <Shell title={t("my_analytics")}>
      {d.exams_taken === 0 ? <div className="card sx-empty"><span className="sx-empty-ico" aria-hidden><Icon n="trend" size={26} /></span><p className="muted">{t("no_results")}</p></div> : (
        <>
          <section className="sx-proj">
            <p className="sx-eyebrow">{t("projected_division")}</p>
            {p.division ? <><p className="sx-proj-big">{t("division")} {p.division}</p><p className="sx-proj-sub">{p.meaning} · {p.total_points} {t("points")}</p></>
              : <p className="sx-proj-sub">{t("need_subjects", { n: p.subjects_needed, have: p.subjects_taken })}</p>}
            <p className="sx-proj-note"><Icon n="info" size={15} /> {p.note}</p>
          </section>
          <div className="card">
            <h2>{t("subjects_label")}</h2>
            <ul className="list sx-subjrows">
              {p.subjects.map((r: any) => (
                <li key={r.subject} className="sx-subjrow">
                  <Monogram name={r.subject} size={38} />
                  <span className="grow"><b>{r.subject}</b>{r.counted ? "" : <span className="muted small"> ({t("not_counted")})</span>}<br /><span className="muted small">{r.average}% · {r.points} {t("points")}</span></span>
                  <GradeMedal grade={r.grade} size={38} />
                </li>
              ))}
            </ul>
          </div>
          <div className="sx-subjgrid">
            {d.subjects.map((s: any) => (
              <section key={s.subject} className="card sx-subj">
                <div className="sx-subj-head"><Monogram name={s.subject} size={42} /><h2>{s.subject}</h2></div>
                <div className="sx-nums">
                  <div><span className="muted small">{t("avg_short")}</span><b>{s.average}%</b></div>
                  <div><span className="muted small">{t("latest_short")}</span><b>{s.latest}%</b></div>
                  {s.change_from_previous !== null && <div><span className="muted small">&nbsp;</span><b className={s.change_from_previous >= 0 ? "ok" : "no"}>{s.change_from_previous >= 0 ? "▲" : "▼"} {Math.abs(s.change_from_previous)}</b></div>}
                </div>
                <Spark values={s.progress.map((h: any) => h.percent)} label={t("progress_chart")} />
                <h3>{t("topics")}</h3>
                {s.topics.map((x: any) => <div key={x.topic} className={`sx-topic ${x.percent >= 60 ? "strong" : "weak"}`}><div className="row"><span className="grow">{x.topic}</span><b>{Math.round(x.percent)}%</b></div><Bar value={x.percent} label={x.topic} /></div>)}
                {s.revise?.length > 0 && <p className="hint"><b>{t("revise")}:</b> {s.revise.join(", ")}</p>}
              </section>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
