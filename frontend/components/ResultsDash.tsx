"use client";
/* The top of the results list: her average, how many exams, how many passed, a trend line, and a card for each subject (tap to filter). */
import { CountUp } from "@/components/ui";
import { useSession } from "@/lib/session";
import "./result-plus.css";

export type Summary = {
  count: number; average: number; passed: number; improving: number; trend: number[];
  best: { attempt_id: number; exam: string; subject: string; percent: number } | null;
  subjects: { subject: string; count: number; average: number; last: number; delta: number | null }[];
};

function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return null;
  const W = 320, H = 44, pad = 5, lo = Math.min(...v, 0), hi = Math.max(...v, 100);
  const pts = v.map((y, i) => [pad + (i * (W - 2 * pad)) / (v.length - 1), H - pad - ((y - lo) / (hi - lo || 1)) * (H - 2 * pad)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="rl-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-hidden>
      <path d={d} pathLength={1} vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={4} />
    </svg>
  );
}

export function Dash({ s }: { s: Summary }) {
  const { t } = useSession();
  return (
    <section className="rl-dash" aria-label={t("my_analytics")}>
      <div className="rl-top">
        <div className="rl-avg"><div><b><CountUp to={Math.round(s.average)} />%</b><small>{t("rl_avg")}</small></div></div>
        <div className="rl-nums">
          <div><b><CountUp to={s.count} /></b><span>{t("rl_exams")}</span></div>
          <div><b><CountUp to={s.passed} /></b><span>{t("rl_passed")}</span></div>
          <div><b><CountUp to={Math.round(s.best?.percent ?? 0)} />%</b><span>{t("rl_best_short")}</span></div>
        </div>
      </div>
      <Spark v={s.trend} />
      {s.improving >= 2 && <span className="rl-streak">{t("rl_improving", { n: s.improving })}</span>}
    </section>
  );
}

export function SubjectChips({ s, value, onPick }: { s: Summary; value: string; onPick: (v: string) => void }) {
  const { t } = useSession();
  if (s.subjects.length < 2) return null;
  return (
    <div className="rl-subjects" role="group" aria-label={t("rl_all")}>
      <button type="button" className="rl-sub" aria-pressed={value === ""} onClick={() => onPick("")} style={{ "--i": 0 } as any}><b>{t("rl_all")}</b><span>{s.count} · {Math.round(s.average)}%</span></button>
      {s.subjects.map((x, i) => (
        <button key={x.subject} type="button" className="rl-sub" aria-pressed={value === x.subject} onClick={() => onPick(value === x.subject ? "" : x.subject)} style={{ "--i": i + 1 } as any}>
          <b>{x.subject}</b>
          <span>{Math.round(x.average)}% {x.delta != null && x.delta !== 0 && <span className={`d ${x.delta > 0 ? "up" : "down"}`}>{x.delta > 0 ? "▲" : "▼"}{Math.abs(Math.round(x.delta))}</span>}</span>
        </button>
      ))}
    </div>
  );
}
