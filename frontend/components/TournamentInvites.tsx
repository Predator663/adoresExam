"use client";
import "./tournament.css";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { AVATAR_EMOJI } from "@/lib/emoji";
import { useSession } from "@/lib/session";

type Invite = { id: number; subject: string; question_count: number; seconds_per_question: number; expires_at: string; stakes?: { gap: number; win_pct: number; penalty: number }; opponent: { id: number; name: string; avatar: string } };

const TXT = {
  en: { challenged: "{name} challenged you!", sub: "{subject} · {n} questions · {s} s each", left_m: "{n} min left", left_h: "{n} h left", left_d: "{n} days left", accept: "Accept", decline: "Decline", later: "Later", more: "+{n} more waiting",
    waiting_one: "1 challenge waiting", waiting_n: "{n} challenges waiting", section: "Challenges waiting for you", fail: "That did not work. Try again.", up: "🔥 Win = +{n}% XP", down: "⚠️ Lose = −{n} XP" },
  sw: { challenged: "{name} amekupa changamoto!", sub: "{subject} · maswali {n} · sekunde {s} kila moja", left_m: "Dakika {n} zimebaki", left_h: "Saa {n} zimebaki", left_d: "Siku {n} zimebaki", accept: "Kubali", decline: "Kataa", later: "Baadaye", more: "+{n} zaidi zinasubiri",
    waiting_one: "Changamoto 1 inasubiri", waiting_n: "Changamoto {n} zinasubiri", section: "Changamoto zinazokusubiri", fail: "Haikufanikiwa. Jaribu tena.", up: "🔥 Ushindi = +{n}% XP", down: "⚠️ Kushindwa = −XP {n}" },
};
const useT = () => {
  const { lang } = useSession();
  const d = TXT[lang === "sw" ? "sw" : "en"];
  const f = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
  return { d, f };
};
const stakeLine = (i: Invite, d: any, f: any) => (i.stakes && i.stakes.gap > 0 ? f(d.up, { n: i.stakes.win_pct - 100 }) : i.stakes && i.stakes.gap < 0 ? f(d.down, { n: i.stakes.penalty }) : "");
const leftText = (iso: string, d: typeof TXT.en, f: (s: string, v: any) => string) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return m < 90 ? f(d.left_m, { n: Math.max(1, m) }) : m < 60 * 36 ? f(d.left_h, { n: Math.round(m / 60) }) : f(d.left_d, { n: Math.round(m / 1440) });
};

/* ---- one shared copy of "the challenges waiting for me": the pop-up, the pill and the home card all read it, one request feeds them all */
let cache: Invite[] | null = null;
const subs = new Set<(x: Invite[]) => void>();
export async function refreshInvites() {
  try { const r = await api<{ invites: Invite[] }>("/tournaments/invites/"); cache = r.invites; subs.forEach((f) => f(cache!)); } catch { /* offline: keep what we have */ }
}
function useInvites() {
  const [list, setList] = useState<Invite[] | null>(cache);
  useEffect(() => { subs.add(setList); if (cache === null) refreshInvites(); else setList(cache); return () => { subs.delete(setList); }; }, []);
  return list;
}

const seenKey = (uid: any) => `amani_tn_seen:${uid}`;
const loadSeen = (uid: any): number[] => { try { return JSON.parse(localStorage.getItem(seenKey(uid)) || "[]"); } catch { return []; } };
const saveSeen = (uid: any, v: number[]) => { try { localStorage.setItem(seenKey(uid), JSON.stringify(v.slice(-50))); } catch { /* private mode: it just shows again next time */ } };

/** Accept = open the challenge (rules and Start); the clock does not run until she presses Start. Decline = tell the challenger no. */
function useActions() {
  const router = useRouter(), { d } = useT();
  const [busy, setBusy] = useState<number | null>(null), [err, setErr] = useState("");
  const accept = (id: number) => {
    if (location.pathname.startsWith("/tournaments")) window.dispatchEvent(new CustomEvent("amani:tn-open", { detail: id }));  // already on that page: just open it
    else router.push(`/tournaments/?id=${id}`);
  };
  const decline = async (id: number) => {
    setBusy(id); setErr("");
    try { await api(`/tournaments/${id}/decline/`, { body: {} }); await refreshInvites(); window.dispatchEvent(new Event("amani:notifications")); } catch (e: any) { setErr(e?.message || d.fail); await refreshInvites(); }
    setBusy(null);
  };
  return { accept, decline, busy, err };
}

/* ----------------------------------------------------------------------------------------------- the pop-up at the top of every page */

export function InviteBanner() {
  const { user } = useSession(), path = usePathname() || "/", { d, f } = useT();
  const list = useInvites(), act = useActions();
  const [seen, setSeen] = useState<number[]>([]), [rolling, setRolling] = useState<number | null>(null), [ready, setReady] = useState(false);
  const uid = user?.id;
  useEffect(() => { if (uid) { setSeen(loadSeen(uid)); setReady(true); } }, [uid]);
  // keep it fresh: every minute while the tab is visible, when she returns to the tab, and whenever the app hears about a notification
  useEffect(() => {
    const go = () => { if (document.visibilityState === "visible") refreshInvites(); };
    const i = setInterval(go, 60_000);
    document.addEventListener("visibilitychange", go); window.addEventListener("focus", go); window.addEventListener("amani:notifications", go);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", go); window.removeEventListener("focus", go); window.removeEventListener("amani:notifications", go); };
  }, []);
  const mark = useCallback((id: number) => { setSeen((s) => { const n = s.includes(id) ? s : [...s, id]; saveSeen(uid, n); return n; }); }, [uid]);

  const hide = path.startsWith("/exam") || path.startsWith("/tournaments") || path.startsWith("/login");  // never interrupt an exam or the tournament screens
  const waiting = list ?? [];
  const next = waiting.find((i) => !seen.includes(i.id));
  const shown = !hide && ready && next;
  const pill = !hide && ready && !next && waiting.length > 0;
  const more = waiting.filter((i) => !seen.includes(i.id)).length - 1;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (rolling === null) return; const t = setTimeout(() => { mark(rolling); setRolling(null); window.dispatchEvent(new Event("amani:tn-landed")); }, 520); return () => clearTimeout(t); }, [rolling, mark]);

  if (shown && next) {
    return (
      <div className={`tn-pop${rolling === next.id ? " roll" : ""}`} ref={ref} role="region" aria-live="polite" aria-label={f(d.challenged, { name: next.opponent.name })}>
        <div className="tn-pop-in">
          <span className="tn-av big" aria-hidden>{AVATAR_EMOJI[next.opponent.avatar] || "🙂"}</span>
          <div className="tn-pop-t">
            <b>⚔️ {f(d.challenged, { name: next.opponent.name })}</b>
            <span className="small">{f(d.sub, { subject: next.subject, n: next.question_count, s: next.seconds_per_question })} · {leftText(next.expires_at, d, f)}</span>
            {stakeLine(next, d, f) && <span className="small tn-stake-line">{stakeLine(next, d, f)}</span>}
            {more > 0 && <span className="small muted">{f(d.more, { n: more })}</span>}
            {act.err && <span className="no small" role="alert">⚠ {act.err}</span>}
          </div>
          <div className="tn-pop-b">
            <button className="btn primary" disabled={act.busy === next.id || rolling !== null} onClick={() => { mark(next.id); act.accept(next.id); }}>{d.accept}</button>
            <button className="btn danger" disabled={act.busy === next.id || rolling !== null} onClick={() => act.decline(next.id)}>{act.busy === next.id ? "…" : d.decline}</button>
            <button className="btn" disabled={rolling !== null} onClick={() => setRolling(next.id)}>{d.later}</button>
          </div>
        </div>
      </div>
    );
  }
  if (pill) {
    return <button type="button" className="tn-pill" onClick={() => { setSeen([]); saveSeen(uid, []); }} aria-label={waiting.length === 1 ? d.waiting_one : f(d.waiting_n, { n: waiting.length })}>
      ⚔️ {waiting.length === 1 ? d.waiting_one : f(d.waiting_n, { n: waiting.length })}</button>;
  }
  return null;
}

/* ----------------------------------------------------------------------------------------------- the same challenges, as a card on her screen */

export function InviteSection({ onChange }: { onChange?: () => void }) {
  const { d, f } = useT();
  const list = useInvites(), act = useActions();
  const [flash, setFlash] = useState(false);
  useEffect(() => { const on = () => { setFlash(true); setTimeout(() => setFlash(false), 1600); }; window.addEventListener("amani:tn-landed", on); return () => window.removeEventListener("amani:tn-landed", on); }, []);
  if (!list || !list.length) return null;
  return (
    <section className={`card tn-sec${flash ? " flash" : ""}`} aria-label={d.section}>
      <h2 style={{ margin: 0 }}>⚔️ {d.section}</h2>
      {list.map((i) => (
        <div key={i.id} className="tn-sec-row">
          <span className="tn-av" aria-hidden>{AVATAR_EMOJI[i.opponent.avatar] || "🙂"}</span>
          <span className="grow"><b>{f(d.challenged, { name: i.opponent.name })}</b><br /><span className="muted small">{f(d.sub, { subject: i.subject, n: i.question_count, s: i.seconds_per_question })} · {leftText(i.expires_at, d, f)}</span>{stakeLine(i, d, f) && <><br /><span className="small tn-stake-line">{stakeLine(i, d, f)}</span></>}</span>
          <span className="row">
            <button className="btn primary" onClick={() => act.accept(i.id)}>{d.accept}</button>
            <button className="btn danger" disabled={act.busy === i.id} onClick={async () => { await act.decline(i.id); onChange?.(); }}>{d.decline}</button>
          </span>
        </div>
      ))}
      {act.err && <p className="no" role="alert">⚠ {act.err}</p>}
    </section>
  );
}
