"use client";
import { useEffect, useRef, useState } from "react";
import { sfx } from "@/lib/sfx";
import { useSession } from "@/lib/session";
import { ItemContent } from "./Rich";

/** Put the items in order: grab the ⠿ handle and drag (mouse or finger), or use the arrow buttons / arrow keys.
 *  The item lifts with a shadow, the others slide out of its way, the numbers update as it moves and it settles into its place
 *  with a little bounce. Each step has a short sound (the student's Sound switch turns it off). */
type Geo = { tops: number[]; bottoms: number[]; centers: number[]; heights: number[]; gap: number; from: number; startY: number };
type Drag = { id: string; from: number; over: number; dy: number };

export default function SortList({ order, items, onChange, disabled }: { order: string[]; items: any[]; onChange: (o: string[]) => void; disabled?: boolean }) {
  const { t } = useSession();
  const rows = useRef<Record<string, HTMLLIElement | null>>({}), geo = useRef<Geo | null>(null), overRef = useRef(0), ptr = useRef(0), raf = useRef(0), lastDy = useRef(0);
  const [drag, setDrag] = useState<Drag | null>(null), [settling, setSettling] = useState(false), [landed, setLanded] = useState<string | null>(null);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const move = (i: number, d: number) => {  // the arrow buttons and keys
    const j = i + d; if (disabled || j < 0 || j >= order.length) return;
    const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); sfx.drop(); setLanded(n[j]); setTimeout(() => setLanded(null), 500);
  };

  function update(clientY: number) {
    const g = geo.current; if (!g) return;
    const dy = clientY + window.scrollY - g.startY, center = g.centers[g.from] + dy;
    let over = 0; g.centers.forEach((c, k) => { if (k !== g.from && c < center) over++; });
    if (over !== overRef.current) { overRef.current = over; sfx.tick(); }
    if (Math.abs(dy - lastDy.current) < 0.5 && over === overRef.current) return;  // nothing moved: no need to redraw
    lastDy.current = dy;
    setDrag((d) => (d ? { ...d, dy, over } : d));
  }
  function loop() {  // keeps the page scrolling while the item is held near the top or bottom edge
    const y = ptr.current;
    if (y < 80) window.scrollBy(0, -10); else if (y > window.innerHeight - 80) window.scrollBy(0, 10);
    update(y);
    raf.current = requestAnimationFrame(loop);
  }
  function start(e: React.PointerEvent<HTMLButtonElement>, id: string, i: number) {
    if (disabled || settling || e.button > 0) return;
    e.preventDefault();
    const sy = window.scrollY, rects = order.map((k) => rows.current[k]!.getBoundingClientRect());
    geo.current = { tops: rects.map((r) => r.top + sy), bottoms: rects.map((r) => r.bottom + sy), centers: rects.map((r) => r.top + sy + r.height / 2),
      heights: rects.map((r) => r.height), gap: rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 8, from: i, startY: e.clientY + sy };
    e.currentTarget.setPointerCapture(e.pointerId);
    ptr.current = e.clientY; overRef.current = i;
    setDrag({ id, from: i, over: i, dy: 0 });
    sfx.pick();
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(loop);
  }
  function end() {
    cancelAnimationFrame(raf.current);
    const g = geo.current, d = drag; if (!g || !d) return;
    const over = overRef.current, final = over > g.from ? g.bottoms[over] - g.bottoms[g.from] : over < g.from ? g.tops[over] - g.tops[g.from] : 0;
    setSettling(true); setDrag({ ...d, over, dy: final });  // glide into the slot, then really move it
    setTimeout(() => {
      if (over !== g.from) { const n = [...order]; const [m] = n.splice(g.from, 1); n.splice(over, 0, m); onChange(n); }
      setDrag(null); setSettling(false); geo.current = null;
      setLanded(d.id); sfx.drop(); setTimeout(() => setLanded(null), 600);
    }, 220);
  }

  const shift = (k: number) => {
    const g = geo.current; if (!drag || !g) return 0;
    if (k === drag.from) return drag.dy;
    const hd = g.heights[drag.from] + g.gap;
    if (drag.from < drag.over && k > drag.from && k <= drag.over) return -hd;
    if (drag.from > drag.over && k >= drag.over && k < drag.from) return hd;
    return 0;
  };
  const number = (k: number) => {  // the numbers follow the item as it moves
    if (!drag) return k + 1;
    if (k === drag.from) return drag.over + 1;
    if (drag.from < drag.over && k > drag.from && k <= drag.over) return k;
    if (drag.from > drag.over && k >= drag.over && k < drag.from) return k + 2;
    return k + 1;
  };

  return (
    <ol className={`ordering sort ${drag ? "dragging" : ""}`} aria-label={t("order_help")}>
      <p className="muted small">{t("order_drag")}</p>
      {order.map((id, i) => {
        const it = items.find((x: any) => x.id === id), mine = drag?.id === id;
        return (
          <li key={id} ref={(el) => { rows.current[id] = el; }}
            className={`order-row ${mine ? `lifted ${settling ? "settling" : ""}` : ""} ${drag && !mine ? "room" : ""} ${landed === id ? "landed" : ""}`}
            style={{ translate: `0 ${shift(i)}px` }}>
            <button type="button" className="grip" disabled={disabled} aria-label={`${t("drag_handle")} ${i + 1}`} aria-roledescription="sortable item"
              onPointerDown={(e) => start(e, id, i)} onPointerMove={(e) => { ptr.current = e.clientY; }} onPointerUp={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); move(i, -1); } else if (e.key === "ArrowDown") { e.preventDefault(); move(i, 1); } }}>⠿</button>
            <span className="num">{number(i)}</span>
            <span className="grow"><ItemContent item={it} /></span>
            <button type="button" className="btn icon" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={t("move_up")}>↑</button>
            <button type="button" className="btn icon" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} aria-label={t("move_down")}>↓</button>
          </li>
        );
      })}
    </ol>
  );
}
