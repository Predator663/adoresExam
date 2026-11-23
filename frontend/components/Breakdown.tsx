"use client";
/* How the questions went: one bar split into right / partly right / wrong / not answered. It grows in when it appears, and each part is a button
   that opens the Full exam showing just those questions. */
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import type { Verdict } from "@/lib/review";
import "./result-plus.css";

export type Counts = { full: number; part: number; none: number; skip: number; void: number };

export default function Breakdown({ b, onPick }: { b: Counts; onPick?: (v: Verdict) => void }) {
  const { t } = useSession();
  const [on, setOn] = useState(false);
  useEffect(() => { const h = setTimeout(() => setOn(true), 250); return () => clearTimeout(h); }, []);
  const parts: [Verdict, number, string][] = [["full", b.full, t("rv_f_right")], ["part", b.part, t("rv_f_part")], ["none", b.none, t("rv_f_wrong")], ["skip", b.skip, t("rv_f_skip")]];
  const total = parts.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="bd">
      <div className="bd-bar" role="img" aria-label={parts.map(([, n, l]) => `${l}: ${n}`).join(", ")}>
        {parts.map(([k, n], i) => n > 0 && <i key={k} className={`bd-seg ${k}`} style={{ flexGrow: n, transform: on ? "scaleX(1)" : "scaleX(0)", transitionDelay: `${i * 120}ms` }} />)}
      </div>
      <div className="bd-legend">
        {parts.map(([k, n, label]) => (
          <button key={k} type="button" className={`bd-chip ${k}`} disabled={!n || !onPick} onClick={() => onPick?.(k)} style={{ opacity: n ? 1 : 0.45 }}>
            <span className="bd-dot" aria-hidden />{label} <b>{n}</b><small>{Math.round((n / total) * 100)}%</small>
          </button>
        ))}
      </div>
    </div>
  );
}
