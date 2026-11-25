"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import RelatedStudents from "@/components/RelatedStudents";
import SendMessage from "@/components/SendMessage";
import { api } from "@/lib/api";

/* Anti-cheat tab of the Live monitor (administrators only).
   Draws every writing student on a plan view (metres, north up) from her phone's position, shows who is moving, and raises an
   alert when two students are closer than the alert distance (set by an administrator in Settings → School, 20 m by default). No map tiles are loaded from
   other websites, so student positions never leave the school's own server. Alerts are information for a person to check,
   they are not proof of cheating (the Terms and Privacy policy say so). */

type Checks = { perm?: string; motion?: string };
type PS = { id: number; name: string; class: string; index: string; lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null;
  moving: boolean; moving_source: string; age_s: number; fresh: boolean; poor: boolean; checks: Checks };
type PA = { id: number; a: { id: number; name: string }; b: { id: number; name: string }; distance_m: number; min_distance_m: number; confidence: string;
  first_seen: string; last_seen: string; active: boolean; acknowledged: boolean; duration_s: number; lat?: number | null; lng?: number | null; locked?: boolean };
type PF = { id: number; student: { id: number; name: string; index: string }; kind: string; label: string; severity: "info" | "warning" | "high"; count: number; text: string; meaning: string;
  first_seen: string; last_seen: string; acknowledged: boolean };
type PL = { id: number; a: number; b: number; kind: string; label: string; note: string; distance_m: number };
type PR = { id: number; kind: string; label: string; note: string; a: { id: number; name: string; index: string; class: string }; b: { id: number; name: string; index: string; class: string } };
type NS = { id: number; name: string; class: string; index: string; last_seen_s: number | null; checks: Checks };
type PB = { server_time: string; exam: { id: number; title: string; status: string }; alert_meters: number; lock_enabled?: boolean; writing: number; students: PS[]; no_signal: NS[]; alerts: PA[]; flags?: PF[]; links?: PL[]; enabled: boolean };
export type AcExam = { exam_id: number; title: string; status: string; in_progress: number };

const MPD = 111_320;
/** Smallest zoom: 20 km per pixel, so students spread across the whole country (1,500 km+) still fit. It used to stop at 500 m per pixel (about 250 km across), which hid anyone further away. */
const K_MIN = 0.00005;
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const niceStep = (target: number) => NICE.find((n) => n >= target) ?? NICE[NICE.length - 1];
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);
const ini = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = "square"; o.frequency.value = 660; g.gain.value = 0.12;
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch { /* no sound */ }
}

/* ---- Street, district, region, country for a position ---------------------------------------------------------------------------
   Asked from the school server (which may ask a geocoder), cached per ~11 m cell. Requests go one at a time, at least 1.1 s apart (the
   server and the public geocoder allow one per second), the dots on screen first, then the rest. Nothing is asked while "Show streets" is off. */
type Place = { street: string; area: string; district: string; region: string; country: string; label: string };
const placeCache = new Map<string, Place | null>();
const pkey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
const queued = new Set<string>(), extra = new Set<string>(), retries = new Map<string, number>(), listeners = new Set<() => void>();
let visSet = new Set<string>(), allSet = new Set<string>(), running = false, lastCall = 0, geocoderOff = false;
const notify = () => listeners.forEach((f) => f());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function wantPlaces(all: string[], visible: string[]) {
  allSet = new Set(all); visSet = new Set(visible);
  all.forEach((k) => { if (!placeCache.has(k)) queued.add(k); });
  void pump();
}
function needPlace(key: string) { extra.add(key); if (!placeCache.has(key)) queued.add(key); void pump(); }
async function pump() {
  if (running) return;
  running = true;
  try {
    while (queued.size && !geocoderOff) {
      const ks = [...queued], pick = ks.find((k) => visSet.has(k) || extra.has(k)) ?? ks.find((k) => allSet.has(k));
      if (!pick) { queued.clear(); break; }  // nobody wants the rest any more (toggle off, other exam)
      queued.delete(pick);
      if (placeCache.has(pick)) continue;
      const wait = lastCall + 1100 - Date.now(); if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      const [la, ln] = pick.split(",");
      try {
        const r = await api<Place & { enabled: boolean }>(`/proctoring/place/?lat=${la}&lng=${ln}`);
        if (!r.enabled) { geocoderOff = true; notify(); break; }
        if (r.label) placeCache.set(pick, r);
        else { const n = (retries.get(pick) || 0) + 1; retries.set(pick, n); if (n < 3) queued.add(pick); else placeCache.set(pick, null); }  // empty = busy or unknown: ask again a couple of times
      } catch { placeCache.set(pick, null); }
      notify();
    }
  } finally { running = false; }
}
function usePlaceVersion() {
  const [v, setV] = useState(0);
  useEffect(() => { const f = () => setV((x) => x + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return v;
}
const shortPlace = (p?: Place | null) => (p ? p.street || p.area || p.district || "" : "");
const areaOf = (p?: Place | null) => (p ? [p.district || p.area, p.region].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ") : "");

function PlaceLine({ lat, lng, prefix, on = true }: { lat?: number | null; lng?: number | null; prefix?: string; on?: boolean }) {
  usePlaceVersion();
  const key = lat == null || lng == null ? "" : pkey(lat, lng);
  useEffect(() => { if (key && on) needPlace(key); }, [key, on]);
  if (!on || !key || geocoderOff) return null;
  const hit = placeCache.get(key);
  if (hit === null) return null;
  return <span className="ac-place">📍 {prefix}{hit === undefined ? "Finding place name…" : hit.label}</span>;
}

/** Where the students are: area, region and the streets in it, as far as the place names have arrived. Administrators only. */
function PlaceSummary({ students }: { students: PS[] }) {
  usePlaceVersion();
  const live = students.filter((x) => x.fresh);
  const groups = new Map<string, { n: number; streets: Map<string, number> }>();
  let known = 0;
  for (const st of live) {
    const pl = placeCache.get(pkey(st.lat, st.lng)); if (!pl) continue;
    known++;
    const g = groups.get(areaOf(pl) || "Unknown area") || { n: 0, streets: new Map<string, number>() };
    g.n++; if (pl.street) g.streets.set(pl.street, (g.streets.get(pl.street) || 0) + 1);
    groups.set(areaOf(pl) || "Unknown area", g);
  }
  if (!live.length) return null;
  const rows = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
  return (
    <details className="card ac-places" open={live.length <= 200}>
      <summary><b>Where students are</b> <span className="muted small">· {known} of {live.length} named{known < live.length ? ", more arriving (about one per second)" : ""}</span></summary>
      <ul className="list">
        {rows.slice(0, 12).map(([area, g]) => (
          <li key={area}><div className="row"><span className="grow">{area}</span><b>{g.n}</b></div>
            {g.streets.size > 0 && <span className="muted small">{[...g.streets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ""}`).join(" · ")}</span>}</li>
        ))}
      </ul>
      {rows.length > 12 && <p className="muted small">+{rows.length - 12} more areas</p>}
    </details>
  );
}

const checkText = (c: Checks) => {
  const loc = c.perm === "granted" ? "Location on" : c.perm === "denied" ? "Location BLOCKED" : "Location ?";
  const mo = c.motion === "moving" ? "device moving" : c.motion === "still" ? "device still" : "motion ?";
  return { loc, mo, bad: c.perm === "denied" };
};

/* ------------------------------------------------------------------ the plan view */
function ProxMap({ students, alerts, links, threshold, labels, streets, focusReq }: { students: PS[]; alerts: PA[]; links: PL[]; threshold: number; labels: boolean; streets: boolean; focusReq: { ids: number[]; n: number } | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 440 });
  const [view, setView] = useState({ cx: 0, cy: 0, k: 1 });
  const [auto, setAuto] = useState(true);
  const [tip, setTip] = useState<number | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const pinch = useRef<{ d: number; k: number } | null>(null);

  // The map's zero point is chosen ONCE, when the first positions arrive, and never moved afterwards. It used to be recomputed whenever the
  // number of students changed, which shifted every dot (and, zoomed in, jumped the whole picture by many pixels) each time a student joined or lost signal.
  const originRef = useRef<{ lat: number; lng: number; c: number } | null>(null);
  if (!originRef.current && students.length) {
    const f = students.filter((s) => s.fresh), src = f.length ? f : students;
    const lat = src.reduce((a, p) => a + p.lat, 0) / src.length, lng = src.reduce((a, p) => a + p.lng, 0) / src.length;
    originRef.current = { lat, lng, c: Math.cos((lat * Math.PI) / 180) };
  }
  const origin = originRef.current ?? { lat: 0, lng: 0, c: 1 };
  const xy = useCallback((p: { lat: number; lng: number }) => ({ x: (p.lng - origin.lng) * MPD * origin.c, y: -(p.lat - origin.lat) * MPD }), [origin]);
  const world = useMemo(() => new Map(students.map((s) => [s.id, xy(s)])), [students, xy]);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(() => { const r = box.current!.getBoundingClientRect(); if (r.width) setSize({ w: r.width, h: r.height }); });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const live = students.filter((s) => s.fresh);
    if (!live.length) return setView({ cx: 0, cy: 0, k: 1 });
    const ps = live.map((s) => world.get(s.id)!);
    const minX = Math.min(...ps.map((p) => p.x)), maxX = Math.max(...ps.map((p) => p.x));
    const minY = Math.min(...ps.map((p) => p.y)), maxY = Math.max(...ps.map((p) => p.y));
    const k = Math.min((size.w * 0.78) / Math.max(maxX - minX, 60), (size.h * 0.78) / Math.max(maxY - minY, 60));
    setView({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, k: Math.min(60, Math.max(K_MIN, k)) });
  }, [students, world, size]);
  useEffect(() => { if (auto) fit(); }, [auto, fit]);

  useEffect(() => {  // "Locate" on an alert: zoom so the pair fills the view
    if (!focusReq) return;
    const ps = focusReq.ids.map((id) => world.get(id)).filter(Boolean) as { x: number; y: number }[];
    if (!ps.length) return;
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length, cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const span = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    setAuto(false); setView({ cx, cy, k: Math.min(60, Math.min(size.w, size.h) * 0.8 / Math.max(span * 3, threshold * 3)) });
  }, [focusReq]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = useCallback((f: number, at?: { x: number; y: number }) => {
    setAuto(false);
    setView((v) => {
      const k = Math.min(60, Math.max(K_MIN, v.k * f));
      if (!at) return { ...v, k };
      const wx = v.cx + (at.x - size.w / 2) / v.k, wy = v.cy + (at.y - size.h / 2) / v.k;  // keep the point under the cursor fixed
      return { cx: wx - (at.x - size.w / 2) / k, cy: wy - (at.y - size.h / 2) / k, k };
    });
  }, [size]);

  useEffect(() => {  // wheel zoom needs a non-passive listener to stop the page from scrolling
    const el = box.current; if (!el) return;
    const h = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.25 : 0.8, { x: e.clientX - r.left, y: e.clientY - r.top }); };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [zoom]);

  const sx = (x: number) => (x - view.cx) * view.k + size.w / 2, sy = (y: number) => (y - view.cy) * view.k + size.h / 2;

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
    if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; drag.current = null; }
    setTip(null);
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // setView's updater runs later, after the finger may already have been lifted (which clears drag/pinch), so copy the values first.
    const pn = pinch.current, dg = drag.current;
    if (pts.current.size === 2 && pn) {
      const [a, b] = [...pts.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      setAuto(false); setView((v) => ({ ...v, k: Math.min(60, Math.max(K_MIN, pn.k * (d / pn.d))) }));
    } else if (dg) {
      const dx = e.clientX - dg.x, dy = e.clientY - dg.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { setAuto(false); setView((v) => ({ ...v, cx: dg.cx - dx / v.k, cy: dg.cy - dy / v.k })); }
    }
  };
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; if (!pts.current.size) drag.current = null; };

  /* grid */
  const step = niceStep(110 / view.k);
  const x0 = view.cx - size.w / 2 / view.k, x1 = view.cx + size.w / 2 / view.k, y0 = view.cy - size.h / 2 / view.k, y1 = view.cy + size.h / 2 / view.k;
  const gx: number[] = [], gy: number[] = [];
  for (let x = Math.ceil(x0 / step) * step; x <= x1 && gx.length < 60; x += step) gx.push(x);
  for (let y = Math.ceil(y0 / step) * step; y <= y1 && gy.length < 60; y += step) gy.push(y);
  const barM = niceStep(90 / view.k), barPx = barM * view.k;
  const maxR = Math.max(size.w, size.h) * 1.5;  // a circle much bigger than the view only costs painting time (and its dashes flicker), so it is not drawn

  const relOf = new Map<number, PL>();
  links.forEach((l) => { relOf.set(l.a, l); relOf.set(l.b, l); });
  const inAlert = new Map<number, PA>();
  alerts.filter((a) => a.active).forEach((a) => { inAlert.set(a.a.id, a); inAlert.set(a.b.id, a); });
  const tipS = tip != null ? students.find((s) => s.id === tip) : null;
  const tipPos = tipS ? { x: sx(world.get(tipS.id)!.x), y: sy(world.get(tipS.id)!.y) } : null;
  const tipAlert = tipS ? inAlert.get(tipS.id) : undefined;
  const cls = (s: PS) => (inAlert.has(s.id) ? "al" : !s.fresh ? "st" : s.poor ? "po" : s.moving ? "mv" : "ok");
  const clusters = (() => {
    // Dots merge into one count bubble only when they REALLY overlap on screen (closer than R px). Panning never changes who merges with whom,
    // and a bubble keeps the id of its lowest-numbered student, so nothing flickers between "bubble" and "dots" while zooming near close students.
    const R = 22, bins = new Map<string, number[]>(), cl: { ax: number; ay: number; members: PS[]; sx: number; sy: number }[] = [], singles: PS[] = [];
    for (const st of [...students].sort((p, q) => p.id - q.id)) {
      const w = world.get(st.id); if (!w) continue;
      const X = sx(w.x), Y = sy(w.y);
      if (X < -60 || Y < -60 || X > size.w + 60 || Y > size.h + 60) continue;
      if (inAlert.has(st.id) || tip === st.id) { singles.push(st); continue; }
      const cx = Math.floor(X / R), cy = Math.floor(Y / R);
      let hit = -1;
      for (let i = cx - 1; i <= cx + 1 && hit < 0; i++) for (let j = cy - 1; j <= cy + 1 && hit < 0; j++) {
        for (const idx of bins.get(`${i}:${j}`) || []) if (Math.hypot(cl[idx].ax - X, cl[idx].ay - Y) < R) { hit = idx; break; }
      }
      if (hit >= 0) { const c = cl[hit]; c.members.push(st); c.sx += X; c.sy += Y; continue; }
      cl.push({ ax: X, ay: Y, members: [st], sx: X, sy: Y });
      const k = `${cx}:${cy}`; bins.set(k, [...(bins.get(k) || []), cl.length - 1]);
    }
    const groups: { key: string; x: number; y: number; members: PS[] }[] = [];
    for (const c of cl) { if (c.members.length === 1) singles.push(c.members[0]); else groups.push({ key: String(c.members[0].id), x: c.sx / c.members.length, y: c.sy / c.members.length, members: c.members }); }
    return { groups, singles };
  })();
  usePlaceVersion();
  const sig = streets ? clusters.singles.map((x) => x.id).join(",") + "|" + clusters.groups.map((g) => g.key).join(",") : "";
  useEffect(() => {  // ask for street names: what is on screen first, then everyone else
    if (!streets) { allSet = new Set(); visSet = new Set(); return; }
    const pos = (x: PS) => pkey(x.lat, x.lng);
    wantPlaces(students.filter((x) => x.fresh).map(pos), [...clusters.singles, ...clusters.groups.flatMap((g) => g.members.slice(0, 3))].map(pos));
  }, [streets, sig, students.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ac-map" ref={box}>
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="group" aria-label="Student positions" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <g className="ac-grid" aria-hidden="true">
          {gx.map((x) => <line key={"x" + x} x1={sx(x)} x2={sx(x)} y1={0} y2={size.h} />)}
          {gy.map((y) => <line key={"y" + y} x1={0} x2={size.w} y1={sy(y)} y2={sy(y)} />)}
        </g>
        {alerts.filter((a) => a.active).map((a) => {
          const p = world.get(a.a.id), q = world.get(a.b.id); if (!p || !q) return null;
          return (
            <g key={a.id} className="ac-link" aria-hidden="true">
              <line x1={sx(p.x)} y1={sy(p.y)} x2={sx(q.x)} y2={sy(q.y)} />
              <text x={(sx(p.x) + sx(q.x)) / 2} y={(sy(p.y) + sy(q.y)) / 2 - 8} textAnchor="middle">{fmtDist(a.distance_m)}</text>
            </g>
          );
        })}
        {links.map((l) => {
          // Twins / same house / same room: a dashed line with the kind written above it. The text follows the line when it fits,
          // is shortened when the line is short, and sits above the pair when the line is shorter still (small screens, zoomed out).
          const p = world.get(l.a), q = world.get(l.b); if (!p || !q) return null;
          const x1 = sx(p.x), y1 = sy(p.y), x2 = sx(q.x), y2 = sy(q.y);
          const len = Math.hypot(x2 - x1, y2 - y1), fs = size.w < 420 ? 10 : 12, cw = fs * 0.62;
          const full = `${l.label} · ${fmtDist(l.distance_m)}`;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          let ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; if (ang > 90 || ang < -90) ang += 180;  // never upside down
          const along = len >= l.label.length * cw + 18;
          return (
            <g key={"r" + l.id} className="ac-rel" role="img" aria-label={`${l.label}: ${fmtDist(l.distance_m)} apart. Expected to be close, not locked.`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              {along
                ? <text transform={`translate(${mx} ${my}) rotate(${ang})`} y={-6} textAnchor="middle" fontSize={fs}>{len >= full.length * cw + 18 ? full : l.label}</text>
                : <text x={mx} y={my - 16} textAnchor="middle" fontSize={fs}>{l.label}</text>}
            </g>
          );
        })}
        {clusters.groups.map((g) => {
          // Students whose dots would overlap at this zoom become one bubble with a count; click it to zoom in. Alerts are never merged.
          const cs = g.members.map(cls), c = cs.includes("po") ? "po" : cs.includes("mv") ? "mv" : cs.every((x) => x === "st") ? "st" : "ok";
          const names = g.members.map((m) => m.name).slice(0, 8).join(", ") + (g.members.length > 8 ? ` +${g.members.length - 8} more` : "");
          const zoomTo = () => {
            const ws = g.members.map((m) => world.get(m.id)!), span = Math.max(Math.max(...ws.map((q) => q.x)) - Math.min(...ws.map((q) => q.x)), Math.max(...ws.map((q) => q.y)) - Math.min(...ws.map((q) => q.y)), 20);
            setAuto(false); setView({ cx: ws.reduce((a, q) => a + q.x, 0) / ws.length, cy: ws.reduce((a, q) => a + q.y, 0) / ws.length, k: Math.min(60, Math.max(view.k * 1.8, (Math.min(size.w, size.h) * 0.55) / span)) });
          };
          return (
            <g key={"c" + g.key} className={`ac-pt cl ${c}`} transform={`translate(${g.x} ${g.y})`} tabIndex={0} role="button" aria-label={`${g.members.length} students close together on the map: ${names}. Press to zoom in.`}
              onPointerDown={(e) => e.stopPropagation()} onClick={zoomTo} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && zoomTo()}>
              <title>{names}</title>
              <circle className="ac-dot" r={Math.min(22, 12 + g.members.length / 2)} />
              <text className="ac-ini" textAnchor="middle" dy=".35em">{g.members.length}</text>
              {streets && (() => { const t = g.members.map((m) => placeCache.get(pkey(m.lat, m.lng))).map((pl) => (g.members.length > 4 ? (pl?.district || pl?.area || "") : shortPlace(pl))).find(Boolean); return t ? <text className="ac-name ac-street" y={Math.min(22, 12 + g.members.length / 2) + 14} textAnchor="middle">{t}</text> : null; })()}
            </g>
          );
        })}
        {clusters.singles.map((s) => {
          const w = world.get(s.id)!, X = sx(w.x), Y = sy(w.y);
          const c = cls(s), moving = s.moving && s.fresh;
          return (
            <g key={s.id} className={`ac-pt ${c}`} transform={`translate(${X} ${Y})`} tabIndex={0} role="button"
              aria-label={`${s.name}, ${moving ? "moving" : "still"}${inAlert.has(s.id) ? ", too close to another student" : ""}`}
              onPointerDown={(e) => e.stopPropagation()} onMouseEnter={() => setTip(s.id)} onMouseLeave={() => setTip((t) => (t === s.id ? null : t))}
              onFocus={() => setTip(s.id)} onBlur={() => setTip((t) => (t === s.id ? null : t))} onClick={() => setTip(s.id)}
              onKeyDown={(e) => e.key === "Escape" && setTip(null)}>
              {s.accuracy * view.k > 12 && s.accuracy * view.k < maxR && <circle className={`ac-acc${s.accuracy * view.k > 150 ? " big" : ""}`} r={s.accuracy * view.k} />}
              {inAlert.has(s.id) && threshold * view.k < maxR && <circle className={`ac-ring${threshold * view.k > 150 ? " big" : ""}`} r={threshold * view.k} />}
              {moving && <circle className="ac-ripple" r={9} />}
              {moving && s.heading != null && s.speed != null && s.speed > 0.5 && <path className="ac-arrow" d="M0,-20 L5,-12 L-5,-12 Z" transform={`rotate(${s.heading})`} />}
              <circle className="ac-dot" r={9} />
              <text className="ac-ini" textAnchor="middle" dy=".35em">{s.name.trim().charAt(0).toUpperCase()}</text>
              {labels && <text className="ac-name" y={24} textAnchor="middle">{s.name}</text>}
              {streets && shortPlace(placeCache.get(pkey(s.lat, s.lng))) && <text className="ac-name ac-street" y={labels ? 37 : 24} textAnchor="middle">{shortPlace(placeCache.get(pkey(s.lat, s.lng)))}</text>}
            </g>
          );
        })}
        <g className="ac-scale" aria-hidden="true" transform={`translate(14 ${size.h - 18})`}>
          <line x1={0} x2={barPx} y1={0} y2={0} /><line x1={0} x2={0} y1={-4} y2={4} /><line x1={barPx} x2={barPx} y1={-4} y2={4} />
          <text x={barPx + 8} y={4}>{fmtDist(barM)}</text>
        </g>
        <g className="ac-north" aria-hidden="true" transform={`translate(${size.w - 22} 24)`}><path d="M0,-12 L6,6 L0,2 L-6,6 Z" /><text y="20" textAnchor="middle">N</text></g>
      </svg>
      <div className="ac-ctl">
        <button className="btn icon" aria-label="Zoom in" onClick={() => zoom(1.5)}>+</button>
        <button className="btn icon" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>−</button>
        <button className={`btn icon ${auto ? "on" : ""}`} aria-label="Fit all students" title="Fit all students" onClick={() => setAuto(true)}><Icon n="pin" size={18} /></button>
      </div>
      {students.length > 0 && <div className="ac-hud" aria-hidden="true"><i />{students.filter((x) => x.fresh).length} live on map</div>}
      {!students.length && <p className="ac-none">No student positions yet. They appear as soon as a student starts the exam.</p>}
      {tipS && tipPos && (() => {
        const c = checkText(tipS.checks || {});
        const left = Math.min(Math.max(tipPos.x + 16, 8), size.w - 236), top = Math.min(Math.max(tipPos.y - 12, 8), size.h - 200);
        const other = tipAlert ? (tipAlert.a.id === tipS.id ? tipAlert.b : tipAlert.a) : null;
        return (
          <div className="ac-tip" role="tooltip" style={{ left, top }}>
            <strong>{tipS.name}</strong>
            <small>{tipS.class}{tipS.index ? ` · #${tipS.index}` : ""}</small>
            <span className={tipS.moving ? "mv" : ""}>{!tipS.fresh ? `No update for ${tipS.age_s}s` : tipS.moving ? `Moving (${tipS.moving_source === "gps" ? "position changing" : "device motion"})` : "Staying still"}</span>
            <span>Accuracy ±{Math.round(tipS.accuracy)} m{tipS.poor ? " (too rough to compare)" : ""}{tipS.speed != null && tipS.speed > 0.3 ? ` · ${(tipS.speed * 3.6).toFixed(1)} km/h` : ""}</span>
            {other && <span className="al">⚠ {fmtDist(tipAlert!.distance_m)} from {other.name}</span>}
            {relOf.get(tipS.id) && <span className="rel">👥 {relOf.get(tipS.id)!.label}: {fmtDist(relOf.get(tipS.id)!.distance_m)} from {students.find((x) => x.id === (relOf.get(tipS.id)!.a === tipS.id ? relOf.get(tipS.id)!.b : relOf.get(tipS.id)!.a))?.name ?? "a relative"}, not locked</span>}
            <span className={c.bad ? "al" : "dim"}>{c.loc} · {c.mo}</span>
            <PlaceLine lat={tipS.lat} lng={tipS.lng} prefix="Near " on={streets} />
            <span className="dim">Updated {tipS.age_s}s ago</span>
          </div>
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ the tab */
export default function AntiCheat({ exams }: { exams: AcExam[] }) {
  const list = useMemo(() => exams.filter((e) => e.status === "live" || e.in_progress > 0), [exams]);
  const [examId, setExamId] = useState<number | null>(null);
  const [data, setData] = useState<PB | null>(null);
  const [err, setErr] = useState("");
  const [labels, setLabels] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(Math.floor(Date.now() / 1000)), [nowS, setNowS] = useState(Math.floor(Date.now() / 1000)), [spin, setSpin] = useState(0);
  const [sub, setSub] = useState<"map" | "alerts" | "checks" | "nosig" | "related">("map");  // phone: one section at a time
  const [wide, setWide] = useState(false);  // desktop: map and panel side by side
  useEffect(() => { const m = window.matchMedia("(min-width: 960px)"), f = () => setWide(m.matches); f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  useEffect(() => { const i = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);
  const [streets, setStreets] = useState(true);
  useEffect(() => { try { const v = localStorage.getItem("ac_streets"); if (v !== null) setStreets(v === "1"); } catch { /* ignore */ } }, []);
  const toggleStreets = (on: boolean) => { setStreets(on); try { localStorage.setItem("ac_streets", on ? "1" : "0"); } catch { /* ignore */ } };
  usePlaceVersion();
  const [focus, setFocus] = useState<{ ids: number[]; n: number } | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const busy = useRef(false);

  useEffect(() => { if (!list.length) setExamId(null); else if (examId == null || !list.some((e) => e.exam_id === examId)) setExamId(list[0].exam_id); }, [list, examId]);

  const load = useCallback(async () => {
    if (examId == null || busy.current || document.hidden) return;
    busy.current = true;
    try {
      const d = await api<PB>(`/proctoring/exams/${examId}/`);
      setData(d); setErr(""); setFetchedAt(Math.floor(Date.now() / 1000));
      const open = new Set(d.alerts.filter((a) => a.active && !a.acknowledged).map((a) => a.id));
      if (seen.current && [...open].some((id) => !seen.current!.has(id))) beep();
      seen.current = open;
    } catch (e: any) { setErr(e?.message || "Could not reach the server."); }
    finally { busy.current = false; }
  }, [examId]);

  useEffect(() => {
    seen.current = null; setData(null);
    load();
    const t = setInterval(load, 4000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);

  const review = async (id: number) => { try { await api(`/proctoring/alerts/${id}/ack/`, { body: {} }); load(); } catch (e: any) { setErr(e?.message || "Could not save."); } };

  const [msgTo, setMsgTo] = useState<{ id: number; name: string }[] | null>(null);
  const markRelated = async (ids: number[], kind: string) => {
    try { await api("/proctoring/relations/", { body: { students: ids, kind } }); load(); }
    catch (e: any) { setErr(e?.message || "Could not save."); }
  };
  const reviewFlag = async (id: number) => { try { await api(`/proctoring/flags/${id}/ack/`, { body: {} }); load(); } catch (e: any) { setErr(e?.message || "Could not save."); } };
  const flags = data?.flags ?? [];
  const openFlags = flags.filter((f) => !f.acknowledged && f.severity !== "info");

  const unlock = async (id: number) => { try { await api(`/proctoring/alerts/${id}/unlock/`, { body: {} }); load(); } catch (e: any) { setErr(e?.message || "Could not unlock."); } };
  const unlockAll = async () => { if (!examId || !confirm("Unlock every locked student of this exam?")) return; try { await api(`/proctoring/exams/${examId}/unlock-all/`, { body: {} }); load(); } catch (e: any) { setErr(e?.message || "Could not unlock."); } };

  const locked = data?.alerts.filter((a) => a.locked) ?? [];
  const active = data?.alerts.filter((a) => a.active) ?? [];
  const past = data?.alerts.filter((a) => !a.active) ?? [];
  const moving = data?.students.filter((s) => s.moving && s.fresh).length ?? 0;
  const tracked = data?.students.filter((s) => s.fresh).length ?? 0;

  const noSig = data?.no_signal.length ?? 0;
  const panel = wide ? (sub === "checks" || sub === "nosig" ? sub : "alerts") : sub;
  const ago = Math.max(0, nowS - fetchedAt);
  const kpi: [string, string | number, string, string, boolean][] = [
    ["pencil", data?.writing ?? "–", "writing", "b", false], ["pin", data ? tracked : "–", "located", "g", false], ["activity", data ? moving : "–", "moving", "b", false],
    ["shield", data ? active.length : "–", "too close", "r", active.length > 0], ["radar", data ? openFlags.length : "–", "to check", "a", openFlags.length > 0],
    ...(data?.lock_enabled ? [["lock", locked.length * 2, "locked", "r", locked.length > 0] as [string, number, string, string, boolean]] : []),
  ];
  const tabs: [typeof sub, string, number | null, boolean][] = [
    ...(wide ? [] : [["map", "Map", null, false] as [typeof sub, string, number | null, boolean]]),
    ["alerts", "Alerts", data ? active.length : null, active.length > 0], ["checks", "Checks", data ? openFlags.length : null, openFlags.length > 0], ["nosig", "No signal", data ? noSig : null, false],
    ...(wide ? [] : [["related", "Related", null, false] as [typeof sub, string, number | null, boolean]]),
  ];
  const locate = (ids: number[]) => { setFocus({ ids, n: Date.now() }); if (!wide) setSub("map"); };

  if (!list.length) return <div className="lm-empty"><Icon n="radar" size={28} /><p>No exam is being written right now. Positions appear here while an exam is live.</p></div>;
  return (
    <div className="ac acx">
      <header className="lm-hero acx-hero">
        <div className="lm-status">
          <span className={`lm-dot ${err ? "bad" : ""}`} aria-hidden="true" />
          <span className="lm-status-txt"><b>{err ? "Connection lost" : "Anti-cheat"}</b><small className={err ? "lm-bad" : ""}>{err ? "Trying again…" : ago < 3 ? "Updated just now" : `Updated ${ago < 60 ? `${ago} s` : `${Math.floor(ago / 60)} min`} ago`}</small></span>
          <button className="lm-refresh" onClick={() => { setSpin((n) => n + 1); load(); }} aria-label="Refresh now"><span key={spin} className="lm-spin"><Icon n="refresh" size={18} /></span></button>
        </div>
        <label className="acx-exam"><span>Exam</span>
          <select className="input" value={examId ?? ""} onChange={(e) => setExamId(Number(e.target.value))} aria-label="Exam">
            {list.map((e) => <option key={e.exam_id} value={e.exam_id}>{e.title}{e.status === "live" ? " · LIVE" : ""}</option>)}
          </select></label>
        <div key={fetchedAt} className={`lm-sweep ${err ? "off" : ""}`} aria-hidden="true" />
      </header>

      <div className="acx-kpis">
        {kpi.map(([ic, n, label, tone, hot]) => (
          <div key={label} className={`lm-kpi t-${tone} ${hot ? "on bad" : ""}`}>
            <span className="lm-kpi-ic" aria-hidden="true"><Icon n={ic} size={18} /></span>
            <b>{n}</b><small>{label}</small>
          </div>
        ))}
      </div>

      <div className="acx-opts" role="group" aria-label="Map options">
        <button type="button" className={`acx-chip ${labels ? "on" : ""}`} aria-pressed={labels} onClick={() => setLabels(!labels)}>Names</button>
        <button type="button" className={`acx-chip ${streets && !geocoderOff ? "on" : ""}`} aria-pressed={streets && !geocoderOff} disabled={geocoderOff}
          title={geocoderOff ? "Place names are switched off on the server (GEOCODER_URL is empty)." : "Street, area and region names next to each student. While this is on, rounded positions (no names) are sent to the geocoder; off sends nothing."}
          onClick={() => toggleStreets(!streets)}>Streets</button>
      </div>

      {err && <p className="lb-alert lm-alert" role="alert">{err} Retrying…</p>}
      {data && !data.enabled && <p className="lb-alert lm-alert">Location monitoring is switched off on the server (PROCTORING_ENABLED=0).</p>}
      {locked.length > 0 && (
        <div className="ac-banner ac-locked" role="alert"><Icon n="shield" size={20} /> <b>{locked.length === 1 ? "2 students are locked out of their exam." : `${locked.length * 2} students are locked out of their exam.`} Their timers keep running, unlock them as soon as they have moved apart.</b>
          <button className="btn" onClick={unlockAll}>Unlock all</button></div>
      )}
      {data && !data.lock_enabled && <p className="muted small lm-note">Locking is off. Turn it on in Settings → School to lock students who sit closer than {data.alert_meters} m.</p>}
      {active.length > 0 && (
        <div className="ac-banner" role="alert"><Icon n="shield" size={20} /> <b>{active.length === 1 ? "Two students are" : `${active.length} pairs of students are`} sitting less than {data?.alert_meters ?? 20} m apart.</b></div>
      )}

      <div className="acx-grid">
        <div className="lm-tabs acx-tabs" role="tablist" aria-label="Anti-cheat sections">
          {tabs.map(([k, label, n, hot]) => (
            <button key={k} role="tab" aria-selected={panel === k} className={panel === k ? "on" : ""} onClick={() => setSub(k)}>
              {label}{n !== null && <b className={hot ? "lm-pulse acx-hot" : ""}>{n}</b>}
            </button>
          ))}
        </div>

        <div className={`acx-mapcol ${!wide && panel !== "map" ? "acx-off" : ""}`}>
          <ProxMap key={examId ?? 0} students={data?.students ?? []} alerts={data?.alerts ?? []} links={data?.links ?? []} threshold={data?.alert_meters ?? 20} labels={labels} streets={streets && !geocoderOff} focusReq={focus} />
          {streets && !geocoderOff && <PlaceSummary students={data?.students ?? []} />}
          <p className="ac-legend" aria-hidden="true">
            <span><i className="d ok" />still</span><span><i className="d mv" />moving</span><span><i className="d al" />too close</span><span><i className="d po" />rough position</span><span><i className="d st" />no recent update</span>
          </p>
        </div>

        <div className={`acx-panel ${!wide && panel === "map" ? "acx-off" : ""}`} role="tabpanel">
          {!data && <div className="lm-skel" aria-hidden="true">{[0, 1].map((k) => <div key={k} className="lm-card"><i className="s1" /><i className="s2" /><i className="s3" /></div>)}</div>}

          {data && panel === "alerts" && (
            <div className="acx-sw">
              <h3 className="acx-h">Too close <small>{active.length} open · {past.length} ended</small></h3>
              {!data.alerts.length ? <div className="lm-empty"><Icon n="shield" size={26} /><p>Nobody has been closer than {data.alert_meters} m.</p></div> : (
                <ul className="acx-list">
                  {[...active, ...past].map((a, idx) => (
                    <li key={a.id} className={`acx-card ${a.active ? "hot" : "off"}`} style={{ ["--i" as any]: Math.min(idx, 10) }}>
                      <div className="acx-card-h">
                        <span className="acx-pair" aria-hidden="true"><b>{ini(a.a.name)}</b><b>{ini(a.b.name)}</b></span>
                        <div className="acx-who"><b>{a.a.name}</b><b>{a.b.name}</b></div>
                        <span className={`acx-dist ${a.active ? "on" : ""}`}>{a.active ? fmtDist(a.distance_m) : fmtDist(a.min_distance_m)}</span>
                      </div>
                      <div className="lm-flags">
                        <i className={`lm-chip ${a.active ? "bad" : ""}`}>{a.active ? "apart now" : "ended · closest"}</i>
                        <i className="lm-chip">since {hhmm(a.first_seen)}</i>
                        <i className={`lm-chip ${a.confidence === "confirmed" ? "ok" : ""}`}>{a.confidence === "confirmed" ? "precise" : "rough position, check"}</i>
                        {a.locked && <i className="lm-chip bad">🔒 locked</i>}
                        {a.acknowledged && <i className="lm-chip ok">Reviewed</i>}
                      </div>
                      {a.active && <PlaceLine lat={a.lat} lng={a.lng} prefix="Near " on={streets} />}
                      <div className="acx-act">
                        {a.active && <button className="btn" onClick={() => locate([a.a.id, a.b.id])}>Locate</button>}
                        {a.locked && <button className="btn primary" onClick={() => unlock(a.id)}>{a.active ? "Unlock (still close)" : "Unlock"}</button>}
                        <button className="btn" onClick={() => setMsgTo([a.a, a.b])}>Message</button>
                        {!a.acknowledged && <button className="btn" onClick={() => review(a.id)}>Mark reviewed</button>}
                        <select className="input sm" aria-label={`Mark ${a.a.name} and ${a.b.name} as related`} value="" onChange={(e) => { const k = e.target.value; if (k && confirm(`Mark ${a.a.name} and ${a.b.name} as related (${e.target.selectedOptions[0].text})? They will no longer raise alerts or be locked.`)) markRelated([a.a.id, a.b.id], k); }}>
                          <option value="">Mark as related…</option><option value="twin">Twins</option><option value="house">Same house</option><option value="room">Same room</option>
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {(data.links?.length ?? 0) > 0 && (
                <>
                  <h3 className="acx-h">Related, close together <small>{data.links!.length} · no alert, not locked</small></h3>
                  <ul className="acx-list">
                    {data.links!.map((l, idx) => { const nm = (id: number) => data.students.find((x) => x.id === id)?.name ?? "Student"; return (
                      <li key={l.id} className="acx-card off" style={{ ["--i" as any]: Math.min(idx, 10) }}>
                        <div className="acx-card-h"><span className="acx-pair" aria-hidden="true"><b>{ini(nm(l.a))}</b><b>{ini(nm(l.b))}</b></span><div className="acx-who"><b>{nm(l.a)}</b><b>{nm(l.b)}</b></div><span className="acx-dist">{fmtDist(l.distance_m)}</span></div>
                        <div className="lm-flags"><i className="lm-chip">{l.label}</i><i className="lm-chip">expected</i></div>
                      </li>); })}
                  </ul>
                </>
              )}
            </div>
          )}

          {data && panel === "checks" && (
            <div className="acx-sw">
              <h3 className="acx-h">Device and position checks <small>{openFlags.length} open</small></h3>
              <p className="muted small lm-note">Signs to look at, not proof: a phone that changed during the exam, or a position that does not behave like real GPS.</p>
              {!flags.length ? <div className="lm-empty"><Icon n="check" size={26} /><p>Nothing unusual so far.</p></div> : (
                <ul className="acx-list">
                  {flags.map((f, idx) => (
                    <li key={f.id} className={`acx-card ${f.acknowledged || f.severity === "info" ? "off" : f.severity === "high" ? "hot" : "warn"}`} style={{ ["--i" as any]: Math.min(idx, 10) }}>
                      <div className="acx-card-h">
                        <span className="acx-av" aria-hidden="true"><Icon n="radar" size={18} /></span>
                        <div className="acx-who"><b>{f.student.name}</b><small>{f.label}{f.count > 1 ? ` ×${f.count}` : ""}</small></div>
                        <span className={`ac-sev ${f.severity}`}>{f.severity === "high" ? "high" : f.severity === "warning" ? "check" : "info"}</span>
                      </div>
                      <p className="acx-text">{f.text}</p>
                      <div className="lm-flags"><i className="lm-chip">since {hhmm(f.first_seen)}</i>{f.count > 1 && <i className="lm-chip">last {hhmm(f.last_seen)}</i>}{f.acknowledged && <i className="lm-chip ok">Reviewed</i>}</div>
                      <div className="acx-act">
                        <button className="btn" onClick={() => setMsgTo([{ id: f.student.id, name: f.student.name }])}>Message</button>
                        {!f.acknowledged && <button className="btn" onClick={() => reviewFlag(f.id)}>Mark reviewed</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {data && panel === "nosig" && (
            <div className="acx-sw">
              <h3 className="acx-h">No location signal <small>{noSig}</small></h3>
              {!noSig ? <div className="lm-empty"><Icon n="check" size={26} /><p>Every writing student is reporting a position.</p></div> : (
                <ul className="acx-list">
                  {data.no_signal.map((s, idx) => { const c = checkText(s.checks || {}); return (
                    <li key={s.id} className="acx-card off" style={{ ["--i" as any]: Math.min(idx, 10) }}>
                      <div className="acx-card-h"><span className="acx-av" aria-hidden="true"><Icon n="pin" size={18} /></span><div className="acx-who"><b>{s.name}</b><small>{s.class}</small></div></div>
                      <div className="lm-flags"><i className="lm-chip bad">{s.last_seen_s == null ? "No position yet" : `Last position ${s.last_seen_s} s ago`}</i><i className="lm-chip">{c.loc}</i></div>
                    </li>); })}
                </ul>
              )}
            </div>
          )}

          {!wide && panel === "related" && <RelatedStudents onChange={load} />}
          {data && panel !== "related" && <p className="muted small lm-note">An alert is information to check, not proof of cheating: siblings or neighbours may live close by. Positions are kept only while the exam runs.</p>}
        </div>
      </div>
      {wide && <RelatedStudents onChange={load} />}
      {msgTo && <SendMessage to={msgTo} onClose={() => setMsgTo(null)} />}
    </div>
  );
}
