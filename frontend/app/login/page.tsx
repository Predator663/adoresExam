"use client";
import { FormEvent, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppName, useBrand } from "@/lib/brand";
import { Loading } from "@/components/ui";
import { ApiError, friendly } from "@/lib/api";
import { diagnose, Diagnosis } from "@/lib/diagnose";
import Footer from "@/components/Footer";
import Logo from "@/components/Logo";

/** The connection test shows server addresses and settings: for the developer only (npm run dev, or add ?debug=1 to the address). */
const DEV = process.env.NODE_ENV === "development" || (typeof location !== "undefined" && /[?&]debug=1/.test(location.search));

/** The server's "too many requests right now" answer (many students logging in together). NOT the account lock-out, which says "wrong attempts". */
const busyServer = (x: unknown) => x instanceof ApiError && x.status === 429 && /throttled/i.test(String(x.data?.detail || ""));
const RETRIES = 5;

/** AUTH-01, AUTH-10: big inputs, show-password, friendly errors. */
export default function Login() {
  const { login, user, ready, t, lang, savePrefs } = useSession();
  const brand = useBrand();
  const appName = useAppName();
  const [u, setU] = useState(""), [p, setP] = useState(""), [show, setShow] = useState(false);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState(""), [diag, setDiag] = useState<Diagnosis | null>(null), [testing, setTesting] = useState(false), [net, setNet] = useState(false), [waiting, setWaiting] = useState("");
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
    } catch (x: any) { setWaiting(""); setErr(friendly(x)); setNet(x instanceof ApiError && x.isNetwork); setBusy(false); }
  }
  return (
    <div className="login-split">
      <div className="login-art" aria-hidden="true"><Logo size={150} /><h2>{appName}</h2><p>{brand.school}</p><p>{t("login_sub")}</p></div>
      <div className="login-wrap"><div className="login-stack">
      <form className="card login" onSubmit={submit}>
        <div className="center"><Logo size={96} label="logo" /><h1>{appName}</h1><p className="muted">{t("login_sub")}</p></div>
        {note && <p className="hint" role="status">{note}</p>}
        <label className="field"><span>{t("username")}</span>
          <input className="input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" required /></label>
        <label className="field"><span>{t("password")}</span>
          <input className="input" type={show ? "text" : "password"} value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></label>
        <label className="switch"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t("show_password")}</label>
        {waiting && <p className="hint" role="status">{waiting}</p>}
        {err && <p className="no" role="alert">⚠ {err}</p>}
        {net && DEV && <button type="button" className="btn" onClick={async () => { setTesting(true); setDiag(await diagnose()); setTesting(false); }}>{testing ? t("loading") : t("test_connection")}</button>}
        {DEV && diag && <div className={`hint ${diag.ok ? "ok" : ""}`} role="status">{diag.lines.map((l, i) => <p key={i} style={{ margin: ".2rem 0" }}>{l}</p>)}</div>}
        <button className="btn primary big" disabled={busy || !u || !p}>{busy ? t("loading") : t("log_in")}</button>
        <p className="center-text"><button type="button" className="btn" onClick={() => savePrefs({ language: lang === "en" ? "sw" : "en" })}>{lang === "en" ? "Kiswahili" : "English"}</button></p>
      </form>
      <Footer compact />
      </div></div>
    </div>
  );
}
