"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";

/** Animated "tips and tricks": one short tip at a time that slides in, with a bouncing picture and a progress line.
 *  Swipe or use the buttons to move; it pauses while a finger is on it or when she presses pause (so nothing moves on its own
 *  without a way to stop it). It never auto-plays for people who asked for less motion. Not shown while an exam is running. */
const TIPS: [string, string][] = [["study", "🗓️"], ["study", "🔁"], ["study", "🗣️"], ["study", "🔍"], ["exam", "✂️"], ["exam", "⏱️"], ["exam", "⏭️"], ["exam", "🔋"], ["phone", "📶"], ["phone", "✈️"], ["study", "😴"], ["study", "🔥"]];
const MS = 9000;

export default function Tips({ cats, className = "" }: { cats?: string[]; className?: string }) {
  const { t } = useSession();
  const list = TIPS.map(([c, e], i) => ({ n: i + 1, c, e })).filter((x) => !cats || cats.includes(x.c));
  const [i, setI] = useState(0), [dir, setDir] = useState<1 | -1>(1), [paused, setPaused] = useState(false), [hold, setHold] = useState(false), [calm, setCalm] = useState(false);
  const x0 = useRef<number | null>(null);
  useEffect(() => {  // a different tip each day to start with
    setI(Math.floor(Date.now() / 86400000) % Math.max(1, list.length));
    setCalm(document.documentElement.classList.contains("reduce-motion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (d: 1 | -1) => { setDir(d); setI((v) => (v + d + list.length) % list.length); };
  const running = !paused && !hold && !calm && list.length > 1;
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => go(1), MS);
    return () => clearTimeout(id);
  }, [i, running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  const tip = list[i % list.length];
  return (
    <section className={`tp ${className}`} aria-label={t("tt_title")}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHold(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setHold(false)}
      onPointerDown={(e) => { x0.current = e.clientX; }}
      onPointerUp={(e) => { if (x0.current !== null) { const dx = e.clientX - x0.current; if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1); } x0.current = null; }}
      onPointerCancel={() => { x0.current = null; }}>
      <div className="tp-prog" aria-hidden><i key={`${i}-${running}`} style={{ ["--ms" as any]: `${MS}ms` }} className={running ? "run" : ""} /></div>
      <div className="tp-head"><span>💡 {t("tt_title")}</span><span className="tp-cat">{t(`tt_${tip.c}`)}</span></div>
      <div className={`tp-body ${dir < 0 ? "back" : ""}`} key={i} aria-live="off">
        <span className="tp-emoji" aria-hidden>{tip.e}</span>
        <div><p className="tp-t">{t(`tt${tip.n}_t`)}</p><p className="tp-b">{t(`tt${tip.n}_b`)}</p></div>
      </div>
      <div className="tp-foot">
        <span className="tp-count muted small" aria-hidden>{(i % list.length) + 1} / {list.length}</span>
        <span className="grow" />
        <button type="button" className="tp-btn" aria-label={t("tt_prev")} onClick={() => go(-1)}>‹</button>
        {!calm && <button type="button" className="tp-btn" aria-label={paused ? t("tt_play") : t("tt_pause")} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? "▶" : "⏸"}</button>}
        <button type="button" className="tp-btn" aria-label={t("tt_next")} onClick={() => go(1)}>›</button>
      </div>
    </section>
  );
}
