"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import { dict } from "./i18n";
import { clearOfflineData, setCurrentUser } from "./offlineStore";
import type { User } from "./types";

type Ctx = {
  user: User | null; ready: boolean; lang: "en" | "sw";
  login: (u: string, p: string) => Promise<User>;
  logout: (reason?: string) => Promise<void>;
  refresh: () => Promise<void>;
  savePrefs: (patch: Record<string, any>) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  notice: string;
};
const C = createContext<Ctx>(null as any);
export const useSession = () => useContext(C);

/** Screens holding unsaved work (the exam builder) register here; logging out waits a moment for them to save first,
 *  while the login token is still valid, so the teacher finds her work again next time. */
const flushers = new Set<() => Promise<unknown>>();
export function onBeforeLogout(fn: () => Promise<unknown>) { flushers.add(fn); return () => { flushers.delete(fn); }; }

const LOCAL = "amani_prefs";
type Local = { language?: "en" | "sw"; theme?: string; text_size?: number; line_spacing?: number; dyslexia_font?: boolean; reduce_motion?: boolean; hc?: "dark" | "light" };
const readLocal = (): Local => { try { return JSON.parse(localStorage.getItem(LOCAL) || "{}"); } catch { return {}; } };

/** ACC-01/02/06: put the student's choices on the page. Remembered on the phone too, so the login screen looks right. */
export function applyPrefs(p: Local) {
  const h = document.documentElement;
  h.dataset.theme = p.theme || "light";
  h.dataset.hc = p.hc || "dark";
  h.style.fontSize = `${p.text_size || 100}%`;
  h.style.setProperty("--ls", String(p.line_spacing || 1.5));
  h.classList.toggle("dyslexia", !!p.dyslexia_font);
  h.classList.toggle("reduce-motion", !!p.reduce_motion);
  h.lang = p.language || "en";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);  // always the newest user, so two quick choices never build on an old copy
  const saveSeq = useRef(0);                  // numbers each save: only the newest answer from the server may change the screen
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [localLang, setLocalLang] = useState<"en" | "sw">("en");
  const lang = user?.language || localLang;

  const push = useCallback((u: User | null) => {
    userRef.current = u;
    setUser(u);
    const l = readLocal();
    if (u) {
      setCurrentUser(u.id);  // offline downloads belong to one person: another person signing in here removes them
      const merged: Local = { ...l, language: u.language, theme: u.theme, text_size: u.accessibility.text_size,
        line_spacing: u.accessibility.line_spacing, dyslexia_font: u.accessibility.dyslexia_font, reduce_motion: u.accessibility.reduce_motion };
      localStorage.setItem(LOCAL, JSON.stringify(merged));
      applyPrefs(merged);
    }
  }, []);

  useEffect(() => {
    const l = readLocal();
    applyPrefs(l);
    setLocalLang(l.language || (navigator.language?.startsWith("sw") ? "sw" : "en"));
    if (!l.reduce_motion && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) document.documentElement.classList.add("reduce-motion");
    if (!getToken()) { setReady(true); return; }
    api<User>("/me/").then(push).catch(() => {}).finally(() => setReady(true));
  }, [push]);

  const logout = useCallback(async (reason?: string) => {
    if (flushers.size && getToken()) {
      const all = Promise.all([...flushers].map((f) => f().catch(() => {})));
      await Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
    }
    try { if (getToken()) await api("/auth/logout/", { method: "POST", body: {} }); } catch { /* already out */ }
    await clearOfflineData();  // her downloaded results and practice questions leave the phone with her
    setToken(null); setUser(null);
    if (reason) setNotice(reason);
    if (!location.pathname.startsWith("/login")) location.href = "/login/";
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      if (!getToken()) return;
      setToken(null); setUser(null);
      sessionStorage.setItem("amani_notice", dict[lang].session_ended);  // AUTH-09: logged in on another device
      if (!location.pathname.startsWith("/login")) location.href = "/login/";
    };
    const onMust = () => { if (!location.pathname.startsWith("/change-password")) location.href = "/change-password/"; };
    window.addEventListener("amani:unauthorized", onUnauthorized);
    window.addEventListener("amani:must-change-password", onMust);
    return () => { window.removeEventListener("amani:unauthorized", onUnauthorized); window.removeEventListener("amani:must-change-password", onMust); };
  }, [lang]);

  const value = useMemo<Ctx>(() => ({
    user, ready, lang, notice,
    login: async (username, password) => {
      const r = await api<{ token: string; user: User }>("/auth/login/", { body: { username, password }, auth: false });
      setToken(r.token); push(r.user); return r.user;
    },
    logout,
    refresh: async () => { push(await api<User>("/me/")); },
    savePrefs: async (patch) => {
      const l = readLocal();
      if ("hc" in patch) { localStorage.setItem(LOCAL, JSON.stringify({ ...l, hc: patch.hc })); applyPrefs({ ...l, hc: patch.hc, ...user && { theme: user.theme } }); delete patch.hc; }
      if (Object.keys(patch).length === 0) return;
      if (!user) { const m = { ...l, ...patch }; localStorage.setItem(LOCAL, JSON.stringify(m)); applyPrefs(m); if (patch.language) setLocalLang(patch.language); return; }
      // Show the choice at once and remember it on the phone; the server's answer only CONFIRMS it. Before, every step of a slider waited
      // for the server and each (older) answer put the page back to an older size, which made the text size jump up and down by itself.
      const mine = ++saveSeq.current;
      const cur = userRef.current || user;
      const ACC = ["text_size", "line_spacing", "dyslexia_font", "reduce_motion", "read_aloud"];
      const acc = Object.fromEntries(Object.entries(patch).filter(([k]) => ACC.includes(k)));
      push({ ...cur, ..."language" in patch && { language: patch.language }, ..."theme" in patch && { theme: patch.theme }, accessibility: { ...cur.accessibility, ...acc } } as User);
      try {
        const fresh = await api<User>("/me/", { method: "PATCH", body: patch });
        if (mine === saveSeq.current) push(fresh);
      } catch {
        // Offline or the server said no: show the server's truth if it can be reached; otherwise the choice stays on this phone.
        if (mine === saveSeq.current) { try { push(await api<User>("/me/")); } catch { /* still offline */ } }
      }
    },
    t: (key, vars) => {
      let s = dict[lang][key] ?? dict.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    },
  }), [user, ready, lang, notice, logout, push]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
