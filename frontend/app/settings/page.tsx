"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import A11yPanel from "@/components/A11yPanel";
import OfflineManager from "@/components/OfflineManager";
import Shell from "@/components/Shell";
import Icon from "@/components/Icon";
import PhotoPicker from "@/components/PhotoPicker";
import { Row, Section, SaveBar, Seg, Switch } from "@/components/settings-ui";
import "@/components/student-settings.css";
import { api } from "@/lib/api";
import { AVATAR_EMOJI } from "@/lib/emoji";
import { useSession } from "@/lib/session";
import { enterNextEnabled, setEnterNext } from "@/lib/enterNext";
import { dataSaverOn, setDataSaver } from "@/lib/dataSaver";
import { autofixEnabled, setAutofix } from "@/lib/autocorrect";

function b64(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** NOT-02: Web Push for installed PWAs (Android, and iPhone with iOS 16.4+ once added to the home screen). */
function PushToggle() {
  const { t } = useSession();
  const [state, setState] = useState<"unknown" | "on" | "off" | "unsupported" | "ios-install">("unknown"), [msg, setMsg] = useState("");
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        const ios = /iPhone|iPad/.test(navigator.userAgent);
        return setState(ios && !(navigator as any).standalone ? "ios-install" : "unsupported");
      }
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);
  async function toggle() {
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) { await api("/push/unsubscribe/", { body: { endpoint: existing.endpoint } }); await existing.unsubscribe(); return setState("off"); }
      const { public_key } = await api<{ public_key: string | null }>("/push/public-key/");
      if (!public_key) return setMsg(t("push_not_ready"));
      if ((await Notification.requestPermission()) !== "granted") return setMsg(t("push_denied"));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(public_key) });
      const j = sub.toJSON();
      await api("/push/subscribe/", { body: { endpoint: j.endpoint, keys: j.keys } });
      setState("on");
    } catch (e: any) { setMsg(e.message || t("push_not_ready")); }
  }
  if (state === "unknown") return null;
  if (state === "unsupported") return <p className="muted small">{t("push_unsupported")}</p>;
  if (state === "ios-install") return <p className="hint">{t("push_ios")}</p>;
  return <><button className="btn" onClick={toggle}>{state === "on" ? `🔕 ${t("push_off")}` : `🔔 ${t("push_on")}`}</button>{msg && <p className="no" role="alert">{msg}</p>}</>;
}

const SECS: [string, string, string, string][] = [["profile", "Me", "Mimi", "users"], ["look", "Look", "Mwonekano", "sun"], ["learn", "Learning", "Kujifunza", "zap"], ["notify", "Alerts", "Arifa", "bell"], ["offline", "Offline", "Nje ya mtandao", "download"], ["account", "Account", "Akaunti", "key"]];
const flag = (k: string, dflt = true) => { try { const v = localStorage.getItem(k); return v === null ? dflt : v !== "off"; } catch { return dflt; } };
const setFlag = (k: string, on: boolean) => { try { localStorage.setItem(k, on ? "on" : "off"); } catch { /* ignore */ } };

const Block = ({ id, n, icon, title, hint, children, h }: { id: string; n: number; icon: string; title: string; hint?: string; children: ReactNode; h: number }) => (
    <div id={`ss-${id}`} className="ss-anchor"><Section icon={icon} title={title} hint={hint} h={h} i={n}>{children}</Section></div>
  );

export default function Settings() {
  const { user, t, lang, savePrefs, logout } = useSession();
  const L = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const student = user?.role === "student";
  const [prof, setProf] = useState<any>(null), [name, setName] = useState(""), [saved, setSaved] = useState(""), [err, setErr] = useState("");
  useEffect(() => { if (student) api("/gamification/profile/").then((p) => { setProf(p); setName(p.display_name); }).catch(() => {}); }, [student]);
  const [enterOn, setEnterOn] = useState(true), [saverOn, setSaverOn] = useState(false), [fixOn, setFixOn] = useState(true), [soundOn, setSoundOn] = useState(true), [hapOn, setHapOn] = useState(true);
  useEffect(() => { setEnterOn(enterNextEnabled()); setSaverOn(dataSaverOn()); setFixOn(autofixEnabled()); setSoundOn(flag("amani_sound")); setHapOn(flag("amani_haptics")); }, []);
  const timer = useRef<any>(null);
  const flash = (m: string) => { setErr(""); setSaved(m); clearTimeout(timer.current); timer.current = setTimeout(() => setSaved(""), 2200); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const patch = async (b: any) => { try { setProf(await api("/gamification/profile/", { method: "PATCH", body: b })); flash(t("saved")); } catch (e: any) { setSaved(""); setErr(e.message || "Error"); } };

  // which section is on screen (highlights the pill) and a smooth jump on tap
  const [at, setAt] = useState("profile");
  useEffect(() => {
    const els = SECS.map(([id]) => document.getElementById(`ss-${id}`)).filter(Boolean) as HTMLElement[];
    if (!("IntersectionObserver" in window) || !els.length) return;
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setAt(v.target.id.slice(3)); }, { rootMargin: "-25% 0px -60% 0px" });
    els.forEach((e) => io.observe(e)); return () => io.disconnect();
  }, [user, prof]);
  const jump = (id: string) => { setAt(id); document.getElementById(`ss-${id}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); };
  const photoOff = prof && prof.photos_enabled === false;
  const glyph = AVATAR_EMOJI[prof?.avatar] || "🦉";
  const shown = (prof?.display_name || user?.first_name || user?.username || "").toString();

  return (
    <Shell title={t("nav_more")}>
      <div className="ss">
        <div className="ss-hero" id="photo">
          <div className="ss-hero-av">
            {photoOff ? <span className="sx-bigavatar" aria-hidden>{glyph}</span>
              : prof ? <PhotoPicker photo={prof.photo} fallback={glyph} onChange={setProf} />
              : <span className="sx-bigavatar" aria-hidden>{(user?.first_name?.[0] || user?.username?.[0] || "?").toUpperCase()}</span>}
          </div>
          <div className="ss-hero-t"><small>{L("Hello", "Habari")}</small><b>{shown}</b><span>@{user?.username}{user?.class ? ` · ${user.class}` : ""}</span></div>
          <i className="ss-orb a" aria-hidden /><i className="ss-orb b" aria-hidden />
        </div>

        <nav className="ss-nav" aria-label={t("nav_more")}>
          {SECS.map(([id, en, sw, ic]) => (
            <button key={id} type="button" className={at === id ? "on" : ""} aria-current={at === id ? "true" : undefined} onClick={() => jump(id)}><Icon n={ic} size={16} />{L(en, sw)}</button>
          ))}
        </nav>

        {student && prof ? (
          <Block id="profile" n={0} icon="users" title={t("my_profile")} hint={t("profile_hint")} h={150}>
            <Row title={t("pick_avatar")} stack>
              <div className="sx-avatars">{prof.avatars.map((a: string) => <label key={a} className={`sx-avatar ${prof.avatar === a ? "on" : ""}`}><input type="radio" name="avatar" checked={prof.avatar === a} onChange={() => patch({ avatar: a })} aria-label={a} /><span aria-hidden>{AVATAR_EMOJI[a]}</span>{prof.avatar === a && <i aria-hidden><Icon n="check" size={13} /></i>}</label>)}</div>
            </Row>
            <Row title={t("display_name")} hint={t("display_name_hint")} stack>
              <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onBlur={() => name !== prof.display_name && patch({ display_name: name })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </Row>
            <Row title={t("hide_leaderboard")} hint={L("Your name will not appear on any class ranking.", "Jina lako halitaonekana kwenye orodha yoyote ya darasa.")}>
              <Switch label={t("hide_leaderboard")} on={!!prof.hide_from_leaderboard} onChange={(b) => patch({ hide_from_leaderboard: b })} />
            </Row>
          </Block>
        ) : <Block id="profile" n={0} icon="users" title={L("Profile", "Wasifu")} h={150}>
          <Row title={`${user?.first_name || ""} ${user?.last_name || ""}`.trim() || (user?.username as string)} hint={`@${user?.username}`}><span className="st-lang">{user?.role}</span></Row>
        </Block>}

        <Block id="look" n={1} icon="sun" title={L("Look and language", "Mwonekano na lugha")} hint={L("Saved to your account, on every device.", "Huhifadhiwa kwenye akaunti yako, kila kifaa.")} h={40}>
          <Row title={t("language")}><Seg label={t("language")} value={lang} onChange={(l) => { savePrefs({ language: l }); flash(t("saved")); }} opts={[["en", "English"], ["sw", "Kiswahili"]]} /></Row>
          <Row title={t("accessibility")} hint={L("Theme, text size, spacing, dyslexia-friendly font, reduced motion, read aloud.", "Mandhari, ukubwa wa maandishi, nafasi, fonti rafiki, mwendo mdogo, kusomewa.")} stack><div className="ss-a11y"><A11yPanel /></div></Row>
        </Block>

        {student ? (
          <Block id="learn" n={2} icon="zap" title={L("Sounds and data", "Sauti na data")} hint={L("Kept on this phone only.", "Huhifadhiwa kwenye simu hii tu.")} h={200}>
            <Row title={L("Sounds", "Sauti")} hint={L("Little pops and chimes in games and practice.", "Sauti ndogo kwenye michezo na mazoezi.")}><Switch label={L("Sounds", "Sauti")} on={soundOn} onChange={(b) => { setSoundOn(b); setFlag("amani_sound", b); flash(t("saved")); }} /></Row>
            <Row title={L("Vibration", "Mtetemo")} hint={L("A small buzz when you answer. Not on every phone.", "Mtetemo mdogo unapojibu. Si kila simu.")}><Switch label={L("Vibration", "Mtetemo")} on={hapOn} onChange={(b) => { setHapOn(b); setFlag("amani_haptics", b); if (b) { try { navigator.vibrate?.(20); } catch { /* ignore */ } } flash(t("saved")); }} /></Row>
            <Row title={t("ds_title")} hint={t("ds_hint")}><Switch label={t("ds_on")} on={saverOn} onChange={(b) => { setSaverOn(b); setDataSaver(b); flash(t("saved")); }} /></Row>
          </Block>
        ) : (
          <Block id="learn" n={2} icon="pencil" title="Writing questions" hint="Kept on this device." h={200}>
            <Row title="Enter jumps to the next field" hint="Shift+Enter makes a new line. Turn off if you prefer Enter for a new line in the question box."><Switch label="Enter jumps to the next field" on={enterOn} onChange={(b) => { setEnterOn(b); setEnterNext(b); flash(t("saved")); }} /></Row>
            <Row title="Auto-capitalise and correct English" hint="Capitals at sentence starts, for I, days, months and names, and common spelling slips. Backspace right after a change puts back what you typed. Only for questions in English."><Switch label="Auto-capitalise and correct English" on={fixOn} onChange={(b) => { setFixOn(b); setAutofix(b); flash(t("saved")); }} /></Row>
          </Block>
        )}

        <Block id="notify" n={3} icon="bell" title={t("notifications")} hint={L("Get a nudge when an exam opens or results are out.", "Pata taarifa mtihani unapofunguliwa au matokeo yakitoka.")} h={20}>
          <Row title={L("Phone notifications", "Arifa za simu")} stack><div><PushToggle /></div></Row>
        </Block>

        <Block id="offline" n={4} icon="download" title={t("off_title")} h={170}><Row title="" stack><OfflineManager /></Row></Block>

        <Block id="account" n={5} icon="key" title={L("Account and shortcuts", "Akaunti na njia za mkato")} h={260}>
          <div className="ss-tiles">
            <Link href="/install/"><Icon n="phone" size={20} /><span>{t("install_app")}</span></Link>
            <Link href="/change-password/"><Icon n="lock" size={20} /><span>{t("change_password")}</span></Link>
            <Link href="/progress/"><Icon n="trend" size={20} /><span>{t("my_analytics")}</span></Link>
            {student && <Link href="/saved/"><Icon n="star" size={20} /><span>{t("my_mistakes_link")}</span></Link>}
            <Link href="/leaderboard/"><Icon n="trophy" size={20} /><span>{t("leaderboard")}</span></Link>
          </div>
          <button type="button" className="btn danger big ss-out" onClick={() => logout()}><Icon n="logout" size={18} /> {t("log_out")}</button>
        </Block>
      </div>
      <SaveBar dirty={false} count={0} busy={false} errors={err ? [err] : []} saved={saved} onSave={() => {}} onDiscard={() => setErr("")} />
    </Shell>
  );
}
