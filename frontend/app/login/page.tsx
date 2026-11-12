"use client";
import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppName, useBrand } from "@/lib/brand";
import { Loading } from "@/components/ui";
import { ApiError, friendly } from "@/lib/api";
import { diagnose, Diagnosis } from "@/lib/diagnose";
import Footer from "@/components/Footer";
import Logo from "@/components/Logo";
import Icon from "@/components/Icon";

/** The connection test shows server addresses and settings: for the developer only (npm run dev, or add ?debug=1 to the address). */
const DEV = process.env.NODE_ENV === "development" || (typeof location !== "undefined" && /[?&]debug=1/.test(location.search));

/** The server's "too many requests right now" answer (many students logging in together). NOT the account lock-out, which says "wrong attempts". */
const busyServer = (x: unknown) => x instanceof ApiError && x.status === 429 && /throttled/i.test(String(x.data?.detail || ""));
const RETRIES = 5;

const FLOATS: [string, string][] = [["book", "a"], ["pencil", "b"], ["trophy", "c"], ["star", "d"], ["medal", "e"], ["target", "f"], ["zap", "g"], ["check", "h"]];
const Person = () => <svg className="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" /></svg>;
const Eye = ({ off }: { off: boolean }) => <svg className="ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" />{off && <path d="M3 3l18 18" />}</svg>;

/** AUTH-01, AUTH-10: big inputs, show-password, friendly errors. The screen is animated (lg-* styles); every animation stops for "reduce motion". */
export default function Login() {
  const { login, user, ready, t, lang, savePrefs } = useSession();
  const brand = useBrand();
  const appName = useAppName();
  const [u, setU] = useState(""), [p, setP] = useState(""), [show, setShow] = useState(false);
  const [errN, setErrN] = useState(0), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState(""), [diag, setDiag] = useState<Diagnosis | null>(null), [testing, setTesting] = useState(false), [net, setNet] = useState(false), [waiting, setWaiting] = useState("");
  useEffect(() => { setNote(sessionStorage.getItem("amani_notice") || ""); sessionStorage.removeItem("amani_notice"); }, []);
  useEffect(() => { if (ready && user) location.replace(user.must_change_password ? "/change-password/" : "/"); }, [ready, user]);
  if (!ready) return <Loading />;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(""); setNet(false); setWaiting(""); setBusy(true);
    try {
      // When a whole class logs in at the same moment the server may ask her to wait: try again by itself, a little later each time.
      let me;
      for (let n = 0; ; n++) {
        try { me = await login(u.trim(), p); break; }
        catch (x) {
          if (!busyServer(x) || n >= RETRIES) throw x;
          setWaiting(lang === "sw" ? `Watu wengi wanaingia sasa hivi. Tunajaribu tena (${n + 1}/${RETRIES})…` : `Many people are logging in right now. Trying again (${n + 1}/${RETRIES})…`);
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000 + n * 1500));
        }
      }
      location.replace(me.must_change_password ? "/change-password/" : "/");
    } catch (x: any) { setWaiting(""); setErr(friendly(x)); setErrN((k) => k + 1); setNet(x instanceof ApiError && x.isNetwork); setBusy(false); }
  }
  const sw = lang === "sw";
  const perks: [string, string][] = [["zap", sw ? "Alama papo hapo" : "Marked instantly"], ["medal", sw ? "Tuzo na mfululizo" : "Badges and streaks"], ["shield", sw ? "Salama na ya haki" : "Safe and fair"]];
  return (
    <div className="lg">
      <aside className="lg-art" aria-hidden="true">
        <i className="lg-blob b1" /><i className="lg-blob b2" /><i className="lg-blob b3" />
        {FLOATS.map(([ic, k], n) => <span key={ic} className={`lg-float f-${k}`} style={{ "--n": n } as CSSProperties}><Icon n={ic} size={26} /></span>)}
        <div className="lg-art-in">
          <div className="lg-crest"><span className="lg-ring r1" /><span className="lg-ring r2" /><Logo size={132} /></div>
          <h2>{appName}</h2>
          <p className="lg-school">{brand.school}</p>
          <p className="lg-tag">{t("login_sub")}</p>
          <ul className="lg-perks">{perks.map(([ic, l], n) => <li key={ic} style={{ "--i": n } as CSSProperties}><Icon n={ic} size={16} />{l}</li>)}</ul>
        </div>
      </aside>

      <main className="lg-main" id="main">
        <div className="lg-top" aria-hidden="true"><i className="lg-blob b1" /><i className="lg-blob b2" /></div>
        <div className="lg-stack">
          <form className="lg-card" onSubmit={submit}>
            <div className="lg-head">
              <div className="lg-mini"><span className="lg-ring r1" /><Logo size={84} label="logo" /></div>
              <h1>{appName}</h1>
              <p className="muted">{t("login_sub")}</p>
            </div>
            {note && <p className="hint" role="status">{note}</p>}
            <label className="lg-field" style={{ "--i": 0 } as CSSProperties}><span>{t("username")}</span>
              <span className="lg-in"><Person />
                <input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" required /></span></label>
            <label className="lg-field" style={{ "--i": 1 } as CSSProperties}><span>{t("password")}</span>
              <span className="lg-in"><Icon n="lock" />
                <input className="input" type={show ? "text" : "password"} value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
                <button type="button" className="lg-eye" aria-pressed={show} aria-label={t("show_password")} title={t("show_password")} onClick={() => setShow(!show)}><Eye off={show} /></button></span></label>
            {waiting && <p className="hint" role="status">{waiting}</p>}
            {err && <p key={errN} className="no lg-err" role="alert">⚠ {err}</p>}
            {net && DEV && <button type="button" className="btn" onClick={async () => { setTesting(true); setDiag(await diagnose()); setTesting(false); }}>{testing ? t("loading") : t("test_connection")}</button>}
            {DEV && diag && <div className={`hint ${diag.ok ? "ok" : ""}`} role="status">{diag.lines.map((l, i) => <p key={i} style={{ margin: ".2rem 0" }}>{l}</p>)}</div>}
            <button className={`btn primary big lg-go ${busy ? "busy" : ""}`} style={{ "--i": 2 } as CSSProperties} disabled={busy || !u || !p}>
              {busy ? <><i className="lg-spin" aria-hidden />{t("loading")}</> : <>{t("log_in")}<Icon n="arrow" size={20} /></>}
            </button>
            <p className="center-text lg-lang"><button type="button" className="btn" onClick={() => savePrefs({ language: lang === "en" ? "sw" : "en" })}>🌐 {lang === "en" ? "Kiswahili" : "English"}</button></p>
          </form>
          <Footer compact />
        </div>
      </main>
    </div>
  );
}
