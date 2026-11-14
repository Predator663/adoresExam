"use client";
/* The student's profile photo. ProfilePhoto draws it (or the emoji avatar until she adds one). PhotoPicker is the whole
   add / change / remove flow: choose or drop a picture, move and zoom it inside a circle, save. The picture is cropped and
   shrunk on her phone first (480 px, about 40 KB), so it uploads in a blink even on a weak connection. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "./ui";
import { api, mediaUrl } from "@/lib/api";
import { useSession } from "@/lib/session";
import "./photo.css";

const TXT = {
  en: { add: "Add your photo", change: "Change photo", remove: "Remove photo", title: "Your photo", drag: "Drag to move. Pinch or use the slider to zoom.", zoom: "Zoom", rotate: "Rotate",
    save: "Save photo", saving: "Saving…", cancel: "Cancel", saved: "Photo saved!", removed: "Photo removed.", drop: "Drop your photo here", reading: "Opening your photo…",
    bad: "We could not open that picture. Please use a JPG or PNG photo.", privacy: "Only you and your teachers can see this photo. Classmates see your avatar.", label: "Profile photo" },
  sw: { add: "Weka picha yako", change: "Badilisha picha", remove: "Ondoa picha", title: "Picha yako", drag: "Buruta kuisogeza. Tumia vidole viwili au kitelezi kukuza.", zoom: "Kuza", rotate: "Zungusha",
    save: "Hifadhi picha", saving: "Inahifadhi…", cancel: "Ghairi", saved: "Picha imehifadhiwa!", removed: "Picha imeondolewa.", drop: "Dondosha picha yako hapa", reading: "Inafungua picha…",
    bad: "Picha hiyo haikufunguka. Tafadhali tumia picha ya JPG au PNG.", privacy: "Wewe na walimu wako tu mnaweza kuiona picha hii. Wanafunzi wenzako wanaona alama yako.", label: "Picha ya wasifu" },
} as const;

/** The photo in a circle, fading in once loaded. Without a photo (or if it fails to load) the emoji `fallback` is shown in `className`. */
export function ProfilePhoto({ photo, fallback, size, className = "" }: { photo?: string; fallback: ReactNode; size: number; className?: string }) {
  const [bad, setBad] = useState(false), [ok, setOk] = useState(false);
  useEffect(() => { setBad(false); setOk(false); }, [photo]);
  if (!photo || bad) return <span className={className} aria-hidden>{fallback}</span>;
  return (
    <span className="pp" style={{ width: size, height: size }} aria-hidden>
      <img key={photo} className={ok ? "in" : ""} src={mediaUrl(photo)} alt="" draggable={false} onLoad={() => setOk(true)} onError={() => setBad(true)} />
      <i className="pp-ph" aria-hidden>{fallback}</i>
    </span>
  );
}

/* ----------------------------------------------------------------------------------------------- the cropper */
const V = 288, OUT = 480, MAX_SRC = 1600;   // viewport (CSS px), saved size, working size of the source
type Off = { x: number; y: number };

function shrink(img: HTMLImageElement): HTMLCanvasElement {  // a 12-megapixel photo would make dragging slow: work on a smaller copy
  const k = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function turn(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = src.height; c.height = src.width;
  const x = c.getContext("2d")!; x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0);
  return c;
}
const limit = (src: HTMLCanvasElement, z: number, o: Off): Off => {  // the picture always covers the circle: no empty corners
  const sc = (V / Math.min(src.width, src.height)) * z, mx = Math.max(0, (src.width * sc - V) / 2), my = Math.max(0, (src.height * sc - V) / 2);
  return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
};
function paint(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, z: number, o: Off, out: number, guide: boolean) {
  const k = out / V, sc = (out / Math.min(src.width, src.height)) * z;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out, out);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, out / 2 + o.x * k - (src.width * sc) / 2, out / 2 + o.y * k - (src.height * sc) / 2, src.width * sc, src.height * sc);
  if (guide) {  // dim everything outside the circle, so she sees what will remain
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.rect(0, 0, out, out); ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2, true); ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(out / 2, out / 2, out / 2 - 1, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

function Cropper({ file, tx, onCancel, onSaved }: { file: File; tx: (typeof TXT)["en"]; onCancel: () => void; onSaved: (p: any) => void }) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null), [z, setZ] = useState(1), [o, setO] = useState<Off>({ x: 0, y: 0 }), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null), pts = useRef(new Map<number, { x: number; y: number }>()), pinch = useRef<{ d: number; z: number } | null>(null), last = useRef<Off | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { try { setSrc(shrink(img)); } catch { setErr(tx.bad); } URL.revokeObjectURL(url); };
    img.onerror = () => { setErr(tx.bad); URL.revokeObjectURL(url); };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = cv.current; if (!c || !src) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = V * dpr; c.height = V * dpr;
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, src, z, o, V, true);
  }, [src, z, o]);
  const zoomTo = useCallback((nz: number) => { if (!src) return; const v = Math.max(1, Math.min(4, nz)); setZ(v); setO((p) => limit(src, v, p)); }, [src]);
  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); last.current = { x: e.clientX, y: e.clientY }; if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z }; } };
  const move = (e: React.PointerEvent) => {
    if (!src || !pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2 && pinch.current) { const [a, b] = [...pts.current.values()]; zoomTo(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d)); return; }
    if (last.current) { const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y; last.current = { x: e.clientX, y: e.clientY }; setO((p) => limit(src, z, { x: p.x + dx, y: p.y + dy })); }
  };
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); pinch.current = null; last.current = pts.current.size ? [...pts.current.values()][0] : null; };
  const key = (e: React.KeyboardEvent) => {
    if (!src) return; const s = 12, m: Record<string, Off> = { ArrowLeft: { x: s, y: 0 }, ArrowRight: { x: -s, y: 0 }, ArrowUp: { x: 0, y: s }, ArrowDown: { x: 0, y: -s } };
    if (m[e.key]) { e.preventDefault(); setO((p) => limit(src, z, { x: p.x + m[e.key].x, y: p.y + m[e.key].y })); }
    else if (e.key === "+" || e.key === "=") zoomTo(z + 0.15); else if (e.key === "-") zoomTo(z - 0.15);
  };
  const wheel = (e: React.WheelEvent) => zoomTo(z * Math.exp(-e.deltaY * 0.0015));
  const rotate = () => { if (!src) return; setSrc(turn(src)); setZ(1); setO({ x: 0, y: 0 }); };
  async function save() {
    if (!src) return; setBusy(true); setErr("");
    try {
      const c = document.createElement("canvas"); c.width = c.height = OUT; paint(c.getContext("2d")!, src, z, o, OUT, false);
      const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      if (!blob) throw new Error(tx.bad);
      const fd = new FormData(); fd.append("photo", blob, "photo.jpg");
      onSaved(await api("/gamification/profile/photo/", { body: fd }));
    } catch (e: any) { setErr(e.message || tx.bad); setBusy(false); }
  }
  return (
    <Modal label={tx.title} onClose={busy ? undefined : onCancel}>
      <div className="pp-crop">
        <h2>{tx.title}</h2>
        {!src && !err && <div className="pp-load" role="status"><i className="spinner" aria-hidden />{tx.reading}</div>}
        {src && (
          <>
            <div className="pp-stage" tabIndex={0} role="group" aria-label={tx.drag} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onKeyDown={key}>
              <canvas ref={cv} style={{ width: V, height: V }} />
              <span className="pp-hand" aria-hidden>✥</span>
            </div>
            <p className="muted small pp-tip">{tx.drag}</p>
            <div className="pp-tools">
              <span aria-hidden>🔍</span>
              <input type="range" min={1} max={4} step={0.01} value={z} aria-label={tx.zoom} onChange={(e) => zoomTo(Number(e.target.value))} />
              <button type="button" className="btn pp-rot" onClick={rotate} aria-label={tx.rotate} title={tx.rotate}>⟳</button>
            </div>
          </>
        )}
        {err && <p className="no" role="alert">⚠ {err}</p>}
        <div className="row">
          <button className="btn primary grow" disabled={!src || busy} onClick={save}>{busy ? <><i className="spinner" aria-hidden /> {tx.saving}</> : tx.save}</button>
          <button className="btn" disabled={busy} onClick={onCancel}>{tx.cancel}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------------------------------------- the picker */
export default function PhotoPicker({ photo, fallback, onChange }: { photo?: string; fallback: ReactNode; onChange: (profile: any) => void }) {
  const { lang } = useSession();
  const tx = TXT[lang === "sw" ? "sw" : "en"];
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null), [drag, setDrag] = useState(false), [msg, setMsg] = useState(""), [err, setErr] = useState(""), [spin, setSpin] = useState(false);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const pick = (f?: File | null) => { setErr(""); if (!f) return; if (!f.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { setErr(tx.bad); return; } setFile(f); };
  const saved = (p: any) => { setFile(null); onChange(p); flash(tx.saved); };
  async function remove() { setSpin(true); try { onChange(await api("/gamification/profile/photo/", { method: "DELETE" })); flash(tx.removed); } catch (e: any) { setErr(e.message); } setSpin(false); }
  return (
    <div className={`pp-pick ${drag ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}>
      <input ref={input} className="sr-only" type="file" accept="image/*" aria-label={tx.label} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <button type="button" className={`pp-btn ${photo ? "has" : ""} ${spin ? "busy" : ""}`} onClick={() => input.current?.click()} aria-label={photo ? tx.change : tx.add}>
        <span className="pp-ring" aria-hidden />
        <span key={photo || "none"} className="pp-face"><ProfilePhoto photo={photo} fallback={<span className="pp-emoji">{fallback}</span>} size={96} className="pp-emoji-wrap" /></span>
        <span className="pp-cam" aria-hidden>📷</span>
        {drag && <span className="pp-drop">{tx.drop}</span>}
      </button>
      <div className="pp-side">
        <button type="button" className="btn pp-link" onClick={() => input.current?.click()}>{photo ? tx.change : tx.add}</button>
        {photo && <button type="button" className="btn ghost pp-link" disabled={spin} onClick={remove}>{tx.remove}</button>}
        <p className="muted small pp-priv">🔒 {tx.privacy}</p>
        {msg && <p className="ok pp-msg" role="status">✓ {msg}</p>}
        {err && <p className="no" role="alert">⚠ {err}</p>}
      </div>
      {file && <Cropper file={file} tx={tx as any} onCancel={() => setFile(null)} onSaved={saved} />}
    </div>
  );
}
