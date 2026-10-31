"use client";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { api, mediaUrl, schoolHost } from "./api";
import { SITE } from "./site";
import { useSession } from "./session";

/** The identity of the school whose web address this is: name, logo, contact. It comes from that school's own settings
 *  (Staff > Settings) through the public /api/branding/ call, so one build of the web app serves every school. */
export type Brand = { school: string; short: string; email: string; phone: string; address: string; logoUrl: string; loaded: boolean };

const EMPTY: Brand = { school: "", short: "", email: "", phone: "", address: "", logoUrl: "", loaded: false };
const Ctx = createContext<Brand>(EMPTY);
const KEY = () => `school_brand:${schoolHost()}`;

function fromApi(d: any): Brand {
  return { school: d.school_name || "", short: d.short_name || "", email: d.contact_email || "", phone: d.contact_phone || "",
           address: d.address || "", logoUrl: mediaUrl(d.logo_url), loaded: true };
}

export const initialOf = (b: Brand) => (b.short || b.school || "?").trim().charAt(0).toUpperCase();

function setLinks(b: Brand) {
  document.title = b.short ? `${b.short} Exams` : SITE.app;
  const href = b.logoUrl || "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='32' fill='#0b6b4f'/><text x='32' y='44' font-size='34' font-family='Arial' font-weight='700' text-anchor='middle' fill='#fff'>${initialOf(b).replace(/[<>&']/g, "")}</text></svg>`);
  for (const rel of ["icon", "apple-touch-icon"]) {
    let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) { el = document.createElement("link"); el.rel = rel; document.head.appendChild(el); }
    el.href = href;
    el.removeAttribute("sizes"); el.removeAttribute("type");
  }
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [b, setB] = useState<Brand>(EMPTY);
  useEffect(() => {
    try { const c = localStorage.getItem(KEY()); if (c) setB({ ...JSON.parse(c), loaded: true }); } catch { /* no saved copy */ }  // instant, before the network answers
    let alive = true;
    api<any>("/branding/", { auth: false }).then((d) => {
      if (!alive) return;
      const nb = fromApi(d); setB(nb);
      try { localStorage.setItem(KEY(), JSON.stringify(nb)); } catch { /* private mode */ }
    }).catch(() => { /* keep the saved copy; the page still works */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (b.loaded) setLinks(b); }, [b]);
  return <Ctx.Provider value={b}>{children}</Ctx.Provider>;
}

export const useBrand = () => useContext(Ctx);

/** "Amani Exams" / "Mitihani ya Amani". Before the school's identity has loaded: the neutral "Online Exams". */
export function useAppName() {
  const b = useBrand();
  const { lang } = useSession();
  if (!b.short) return lang === "sw" ? "Mitihani Mtandaoni" : SITE.app;
  return lang === "sw" ? `Mitihani ya ${b.short}` : `${b.short} Exams`;
}

/** SITE (version, year, developer ...) with the school's own name, app name and contact details on top. */
export function useSite() {
  const b = useBrand();
  return { ...SITE, school: b.school || SITE.school, app: b.short ? `${b.short} Exams` : SITE.app, email: b.email, phone: b.phone, address: b.address };
}
