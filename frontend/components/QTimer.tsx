"use client";
import "./qtimer.css";
import { clockSecs } from "@/lib/timing";

/** The countdown for ONE question: a draining bar and the seconds left. Calm, then amber, then red and pulsing for the last few seconds. */
export default function QTimer({ leftMs, totalSeconds, label }: { leftMs: number; totalSeconds: number; label: string }) {
  const left = Math.max(0, leftMs / 1000), pct = Math.max(0, Math.min(100, (left / totalSeconds) * 100));
  const state = left <= 5 ? "urgent" : left <= 15 || pct <= 20 ? "low" : "ok";
  return (
    <div className={`qt qt-${state}`} role="timer" aria-label={`${label}: ${clockSecs(left)}`}>
      <span className="qt-icon" aria-hidden>⏱</span>
      <div className="qt-track" aria-hidden><div className="qt-fill" style={{ width: `${pct}%` }} /></div>
      <b className="qt-num">{clockSecs(left)}</b>
    </div>
  );
}
