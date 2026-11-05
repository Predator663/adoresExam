"use client";
import type { CSSProperties, ReactNode } from "react";
import { gradeTone, hueOf, initialOfName } from "@/lib/student";

/** A circular progress ring. `value` is 0-100. Children sit in the middle. */
export function Ring({ value, size = 72, stroke = 5, children, label, className = "" }: { value: number; size?: number; stroke?: number; children?: ReactNode; label?: string; className?: string }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const sw = (stroke * 36) / size, r = 18 - sw / 2;  // stroke width in the 36-unit box; the ring stays inside it
  return (
    <span className={`sx-ring ${className}`} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 36 36" focusable="false">
        <circle className="sx-ring-track" cx="18" cy="18" r={r} pathLength={100} strokeWidth={sw} />
        <circle className="sx-ring-arc" cx="18" cy="18" r={r} pathLength={100} strokeWidth={sw} strokeDasharray={`${v} 100`} />
      </svg>
      {children !== undefined && <span className="sx-ring-in">{children}</span>}
    </span>
  );
}

/** The grade as a round medal: A and B green, C neutral, D amber, F red. The letter is always there, so colour is never the only clue. */
export function GradeMedal({ grade, size = 44 }: { grade: string; size?: number }) {
  return <span className={`sx-medal tone-${gradeTone(grade)} g-${(grade || "").trim().toUpperCase()[0] || "x"}`} style={{ width: size, height: size, fontSize: size * 0.46 }} aria-label={grade}>{(grade || "–").slice(0, 2)}</span>;
}

/** A rounded square with the subject's first letter in the subject's own colour. */
export function Monogram({ name, size = 44 }: { name: string; size?: number }) {
  const st = { "--h": hueOf(name), width: size, height: size, fontSize: size * 0.42 } as CSSProperties;
  return <span className="sx-mono" style={st} aria-hidden>{initialOfName(name)}</span>;
}

export function Skeleton({ h = 16, w = "100%", r = 10, className = "" }: { h?: number | string; w?: number | string; r?: number; className?: string }) {
  return <span className={`sx-skel ${className}`} style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

/** A tiny line chart of recent percentages (oldest to newest). Shows the shape of progress without axes. */
export function Spark({ values, label, height = 64 }: { values: number[]; label: string; height?: number }) {
  const n = values.length;
  if (!n) return null;
  const W = 240, H = height, pad = 6;
  const x = (i: number) => (n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1));
  const y = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join("L")}`, area = `${line}L${x(n - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  return (
    <svg className="sx-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path className="sx-spark-area" d={area} />
      {n > 1 && <path className="sx-spark-line" d={line} />}
      {values.map((v, i) => <circle key={i} className={i === n - 1 ? "sx-spark-dot last" : "sx-spark-dot"} cx={x(i)} cy={y(v)} r={i === n - 1 ? 4 : 2.6} />)}
    </svg>
  );
}
