"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { useSession } from "@/lib/session";
import { makePlan, whatIf } from "@/lib/studyplan";

type Subject = { subject: string; topic_history?: { exam_id: number; date?: string | null; topics: Record<string, [number, number]> }[] };

/** "My Study Plan": the study-plan model (lib/studyplan.ts) shown to the student. Runs in her browser on her own results. */
export default function StudyPlan({ subjects }: { subjects: Subject[] }) {
  const { t } = useSession();
  const [pick, setPick] = useState(0), [boost, setBoost] = useState(15), [topicPick, setTopicPick] = useState<string>("");
  const s = subjects[Math.min(pick, subjects.length - 1)];
  const plan = useMemo(() => makePlan(s?.topic_history), [s]);
  if (!subjects.length) return null;
  const focus = plan.topics.filter((x) => x.gain >= 0.5).slice(0, 3);
  const chosen = focus.find((x) => x.topic === topicPick) ?? focus[0];
  const after = chosen ? whatIf(plan, chosen.topic, boost) : null;
  const bt = plan.backtest;
  const tag = plan.confidence;
  return (
    <section className="card sp" aria-labelledby="sp-h">
      <div className="sp-head">
        <span className="sp-ico" aria-hidden><Icon n="trend" size={22} /></span>
        <div><h2 id="sp-h">{t("sp_title")}</h2><p className="muted small">{t("sp_sub")}</p></div>
      </div>
      {subjects.length > 1 && (
        <div className="sp-tabs" role="tablist" aria-label={t("sp_pick")}>
          {subjects.map((x, i) => <button key={x.subject} role="tab" type="button" aria-selected={i === pick} className={i === pick ? "sp-tab on" : "sp-tab"} onClick={() => { setPick(i); setTopicPick(""); }}>{x.subject}</button>)}
        </div>
      )}
      {plan.forecast === null ? <p className="muted">{t("sp_need2")}</p> : (
        <>
          <div className="sp-forecast">
            <p className="sx-eyebrow">{t("sp_next")} · {s.subject}</p>
            <p className="sp-big" aria-live="polite">{Math.round(plan.forecast)}%</p>
            <p className="sp-range">{t("sp_range", { low: Math.round(plan.low as number), high: Math.round(plan.high as number) })}</p>
            <div className="sp-band" aria-hidden><i style={{ left: `${plan.low}%`, width: `${(plan.high as number) - (plan.low as number)}%` }} /><b style={{ left: `${plan.forecast}%` }} /></div>
            <p className="small"><span className={`sp-chip ${tag}`}>{t(`sp_conf_${tag}`)}</span> <span className="muted">{t("sp_note")}</span></p>
          </div>

          <h3>{t("sp_focus")}</h3>
          {focus.length === 0 ? <p className="muted">{t("sp_strong_all")}</p> : (
            <ul className="sp-focus">
              {focus.map((x, i) => (
                <li key={x.topic}>
                  <button type="button" className={`sp-row${chosen?.topic === x.topic ? " on" : ""}`} onClick={() => setTopicPick(x.topic)} aria-pressed={chosen?.topic === x.topic}>
                    <span className="sp-rank">{i + 1}</span>
                    <span className="grow"><b>{x.topic}</b>
                      <span className="sp-meter" role="img" aria-label={`${t("sp_mastery")}: ${Math.round(x.mastery)}%`}><i style={{ width: `${x.mastery}%` }} /></span>
                      <span className="muted small">{t("sp_mastery")} {Math.round(x.mastery)}%{Math.abs(x.trend) >= 3 ? ` · ${x.trend > 0 ? "▲ " + t("sp_trend_up") : "▼ " + t("sp_trend_down")}` : ""}{x.thin ? ` · ${t("sp_thin")}` : ""}</span>
                    </span>
                    <span className="sp-gain">{t("sp_gain", { n: Math.max(1, Math.round(x.gain)) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {chosen && after !== null && (
            <div className="sp-what">
              <label htmlFor="sp-r"><b>{t("sp_whatif", { topic: chosen.topic })}</b> <span className="muted">{t("sp_whatif_by", { n: boost })}</span></label>
              <input id="sp-r" type="range" min={5} max={40} step={5} value={boost} onChange={(e) => setBoost(Number(e.target.value))} />
              <p className="sp-what-res">{t("sp_whatif_res", { n: Math.round(after) })}</p>
            </div>
          )}

          <p className="small muted sp-check">{bt ? t("sp_check", { n: bt.mae.toFixed(1), m: bt.baselineLast.toFixed(1) }) : t("sp_check_few")}</p>
          <Link className="btn primary" href="/practice/">{t("sp_practise", { subject: s.subject })} →</Link>
        </>
      )}
    </section>
  );
}
