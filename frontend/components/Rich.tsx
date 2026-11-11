"use client";
import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/api";
import { placeholderImage, useDataSaver } from "@/lib/dataSaver";
import { useSession } from "@/lib/session";
import { Modal } from "./ui";

/** QB-04: tap an image to zoom, pinch to zoom on phones (the browser handles the pinch inside the scroll box). */
export function ZoomModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useSession();
  const [scale, setScale] = useState(1);
  return (
    <Modal label={alt || t("image")} onClose={onClose}>
      <div className="zoom-box"><img src={src} alt={alt} style={{ width: `${scale * 100}%`, maxWidth: "none" }} /></div>
      <div className="row">
        <button className="btn" onClick={() => setScale((s) => Math.max(1, s - 0.5))} aria-label={t("zoom_out")}>−</button>
        <button className="btn" onClick={() => setScale((s) => Math.min(4, s + 0.5))} aria-label={t("zoom_in")}>+</button>
        <button className="btn primary" onClick={onClose}>{t("close")}</button>
      </div>
    </Modal>
  );
}

/** Question text is cleaned by the server (bleach), so it is safe to show as HTML. Images inside it open the zoom box. */
export function RichHtml({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const { t } = useSession(), saver = useDataSaver();
  useEffect(() => {
    ref.current?.querySelectorAll("img").forEach((img) => {
      if (img.dataset.ds === "1") return;  // already waiting for a tap
      const raw = img.getAttribute("src") || "";
      if (saver && !img.dataset.loaded && !raw.startsWith("data:")) {  // Data saver: show a small box; the picture itself is fetched on tap
        img.dataset.full = mediaUrl(raw); img.dataset.ds = "1";
        img.setAttribute("src", placeholderImage(t("ds_tap")));
        img.setAttribute("alt", img.getAttribute("alt") || t("ds_tap"));
      } else {
        img.setAttribute("src", mediaUrl(raw));
        img.setAttribute("loading", "lazy");
      }
      img.setAttribute("tabindex", "0");
      img.setAttribute("role", "button");
    });
  }, [html, saver, t]);
  const open = (e: { target: EventTarget }) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "IMG" && (el as HTMLImageElement).dataset.ds === "1") {  // first tap loads the real picture
      const img = el as HTMLImageElement;
      img.src = img.dataset.full || img.src; img.dataset.ds = ""; img.dataset.loaded = "1"; return;
    }
    if (el.tagName === "IMG") setZoom({ src: (el as HTMLImageElement).src, alt: el.getAttribute("alt") || "" });
  };
  return (
    <>
      <div ref={ref} className={`rich ${className || ""}`} dangerouslySetInnerHTML={{ __html: html }} onClick={open}
        onKeyDown={(e) => e.key === "Enter" && open(e)} />
      {zoom && <ZoomModal {...zoom} onClose={() => setZoom(null)} />}
    </>
  );
}

/** An answer option, matching item or ordering item: text, an image (with alt text, QB-03), or both. */
export function ItemContent({ item }: { item: { text?: string; image?: string | null; alt_text?: string } }) {
  const [zoom, setZoom] = useState(false), [fetched, setFetched] = useState(false);
  const { t } = useSession(), saver = useDataSaver(), hold = saver && !fetched;  // Data saver: a small box until she taps it
  return (
    <span className="item">
      {item.image && (
        <>
          <img src={hold ? placeholderImage(t("ds_tap"), 160, 80) : mediaUrl(item.image)} alt={item.alt_text || (hold ? t("ds_tap") : "")} loading="lazy" className="thumb"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (hold) setFetched(true); else setZoom(true); }} />
          {zoom && <ZoomModal src={mediaUrl(item.image)} alt={item.alt_text || ""} onClose={() => setZoom(false)} />}
        </>
      )}
      {item.text ? <span dangerouslySetInnerHTML={{ __html: item.text }} /> : null}
    </span>
  );
}
