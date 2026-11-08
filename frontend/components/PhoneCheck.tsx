"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GpsSteps, Steps } from "@/components/GpsHelp";
import { ApiError, api } from "@/lib/api";
import { BLOCKING, diagnose, readEnv, type GpsReason, type PhoneOS } from "@/lib/gps";
import { getFix, lastGeoDetail, readSensors, startMotion, type Fix, type FixError, type Sensors } from "@/lib/proctor";
import { useSession } from "@/lib/session";

/** "Check my phone": one tap, then GPS, Wi-Fi and Bluetooth are checked one after the other with a small animation each.
 *
 *  Honest about what a web page can do: it can NOT switch GPS, Wi-Fi or Bluetooth on (only the phone's owner can). Asking for the
 *  position is what makes the phone ask for location permission and wake its GPS; Wi-Fi and Bluetooth are READ where the browser lets
 *  a page read them (Chrome on Android) and shown as "cannot be checked" elsewhere. When something is off, it says why and how to fix it,
 *  and the check runs again by itself when she comes back from Settings. */

type Row = "idle" | "checking" | "ok" | "info" | "bad";
type Key = "gps" | "net" | "ble";
export type PhoneResult = { ready: boolean; fix?: Fix; sensors?: Sensors; gps: "ok" | GpsReason; net: "wifi" | "mobile" | "online" | "offline"; ble: "on" | "off" | "unknown" };

const KEYS: Key[] = ["gps", "net", "ble"];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const atLeast = (since: number, ms: number) => pause(Math.max(0, ms - (Date.now() - since)));  // every step stays on screen long enough to be seen

/** Is the school's server reachable? A maintenance answer still proves the internet works. */
async function reachable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    await Promise.race([api("/site-status/", { auth: false }), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 7000))]);
    return true;
  } catch (e) { return e instanceof ApiError && !e.isNetwork; }
}

const Icon = ({ k }: { k: Key }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {k === "gps" && <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>}
    {k === "net" && <><path d="M2.5 9a15 15 0 0 1 19 0" /><path d="M5.5 12.5a10.5 10.5 0 0 1 13 0" /><path d="M8.7 16a6 6 0 0 1 6.6 0" /><circle cx="12" cy="19.2" r=".9" fill="currentColor" /></>}
    {k === "ble" && <path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9" />}
  </svg>
);

function State({ s }: { s: Row }) {
  if (s === "checking") return <i className="fx-spin" />;
  if (s === "ok") return <svg viewBox="0 0 24 24" width="20" height="20"><path className="fx-tick" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (s === "bad") return <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
  if (s === "info") return <b>i</b>;
  return <span>·</span>;
}

export default function PhoneCheck({ examId, disabled, runSignal = 0, onChange }: { examId: number; disabled?: boolean; runSignal?: number; onChange: (r: PhoneResult | null) => void }) {
  const { t } = useSession();
  const [rows, setRows] = useState<Record<Key, Row>>({ gps: "idle", net: "idle", ble: "idle" });
  const [text, setText] = useState<Record<Key, string>>({ gps: "", net: "", ble: "" });
  const [running, setRunning] = useState(false), [result, setResult] = useState<PhoneResult | null>(null);
  const [os, setOs] = useState<PhoneOS>("other"), [acc, setAcc] = useState<number | undefined>();
  const busy = useRef(false), gpsFailed = useRef(false), ran = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; ran.current = true;
    setRunning(true); setResult(null); onChange(null);
    setRows({ gps: "checking", net: "idle", ble: "idle" });
    setText({ gps: t("pc_gps_run"), net: t("pc_wait"), ble: t("pc_wait") });
    const set = (k: Key, s: Row, msg: string) => { setRows((r) => ({ ...r, [k]: s })); setText((x) => ({ ...x, [k]: msg })); };
    try {
      await startMotion().catch(() => {});  // on iPhone this is the moment iOS asks for the motion sensor (it needs this tap)
      const env = await readEnv(); setOs(env.os);

      // 1. Location (GPS). Asking for a position is what makes the phone ask for permission and wake its GPS.
      let t0 = Date.now(), fix: Fix | undefined, err: FixError | undefined;
      try { fix = await getFix(20000); } catch (e) { err = e as FixError; }
      await atLeast(t0, 1500);
      const reason = diagnose(err, env, lastGeoDetail(), fix?.accuracy);
      const gpsOk = !!fix && !(reason && BLOCKING.includes(reason));
      gpsFailed.current = !gpsOk; setAcc(fix?.accuracy);
      const gpsWord: PhoneResult["gps"] = gpsOk ? (reason === "weak" ? "weak" : "ok") : (reason || "unknown");
      set("gps", gpsOk ? (reason === "weak" ? "info" : "ok") : "bad",
        gpsOk ? t(reason === "weak" ? "pc_gps_weak" : "pc_gps_ok", { n: Math.round(fix!.accuracy) }) : t(`gps_r_${gpsWord}`));

      // 2. Wi-Fi / internet
      set("net", "checking", t("pc_net_run")); t0 = Date.now();
      const sensors = await readSensors();
      const online = (await reachable()) && sensors.net !== "none";
      await atLeast(t0, 1200);
      const net: PhoneResult["net"] = !online ? "offline" : sensors.net === "wifi" || sensors.net === "ethernet" ? "wifi" : sensors.net === "cellular" ? "mobile" : "online";
      set("net", net === "offline" ? "bad" : net === "wifi" ? "ok" : "info", t(`pc_net_${net}`));

      // 3. Bluetooth
      set("ble", "checking", t("pc_ble_run")); t0 = Date.now();
      await atLeast(t0, 1100);
      const ble: PhoneResult["ble"] = sensors.ble === "on" ? "on" : sensors.ble === "off" ? "off" : "unknown";
      set("ble", ble === "on" ? "ok" : ble === "off" ? "bad" : "info", t(`pc_ble_${ble}`));

      const res: PhoneResult = { ready: gpsOk && net !== "offline" && ble !== "off", fix, sensors, gps: gpsWord === "weak" ? "ok" : gpsWord, net, ble };
      setResult(res); onChange(res);
      if (!res.ready || reason === "weak") {  // tell the school WHY, so a teacher can help (once per reason, kept in the audit log)
        api(`/student/exams/${examId}/device-check/`, { body: { gps: gpsWord === "weak" ? "weak" : res.gps, net, ble, os: env.os } }).catch(() => {});
      }
    } finally { busy.current = false; setRunning(false); }
  }, [examId, onChange, t]);

  useEffect(() => { if (runSignal) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [runSignal]);

  // She switched Location on in Settings and came back (or allowed it for the site): check again by herself, no tap needed.
  useEffect(() => {
    const again = () => { if (!document.hidden && ran.current && gpsFailed.current && !busy.current && !disabled) run(); };
    document.addEventListener("visibilitychange", again);
    let st: PermissionStatus | undefined;
    (navigator as any).permissions?.query({ name: "geolocation" }).then((s: PermissionStatus) => { st = s; s.onchange = () => { if (s.state === "granted") again(); }; }).catch(() => {});
    return () => { document.removeEventListener("visibilitychange", again); if (st) st.onchange = null; };
  }, [run, disabled]);

  const done = KEYS.filter((k) => rows[k] === "ok" || rows[k] === "info" || rows[k] === "bad").length;
  const pct = Math.round((done / 3) * 100);
  const showGps = result && (rows.gps === "bad" || rows.gps === "info");
  return (
    <section className={`pc ${result?.ready ? "ready" : ""}`} aria-labelledby="pc-h">
      <h2 id="pc-h">📍 {t("dev_title")}</h2>
      <p className="muted small">{t("pc_intro")}</p>
      <ol className="pc-list" aria-live="polite">
        {KEYS.map((k) => (
          <li key={k} className={`pc-row ${rows[k]}`} style={{ animationDelay: `${KEYS.indexOf(k) * 80}ms` }}>
            <span className="pc-ico" aria-hidden><i className="pc-ring" /><i className="pc-ring r2" /><Icon k={k} /></span>
            <span className="pc-txt"><b>{t(k === "gps" ? "dev_location" : k === "net" ? "dev_wifi" : "dev_bt")}</b><span>{text[k] || t("pc_idle")}</span></span>
            <span className="pc-st" aria-hidden><State s={rows[k]} /></span>
          </li>
        ))}
      </ol>
      <div className="pc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("dev_check")}><i style={{ width: `${pct}%` }} /></div>

      {showGps && <GpsSteps reason={(result!.gps === "ok" ? "weak" : result!.gps) as GpsReason} os={os} accuracy={acc} />}
      {result && result.net === "offline" && <div className="gh bad" role="group"><p className="gh-title"><b>⚠ {t("pc_net_offline")}</b></p><p className="gh-how"><b>{t("gps_how")}</b></p><Steps text={t("pc_fix_net")} /></div>}
      {result && result.ble === "off" && <div className="gh bad" role="group"><p className="gh-title"><b>⚠ {t("pc_ble_off")}</b></p><p className="gh-how"><b>{t("gps_how")}</b></p><Steps text={t("pc_fix_ble")} /></div>}

      {result?.ready && <p className="pc-done" role="status">✓ {t("pc_ready")}</p>}
      {result && !result.ready && <p className="no" role="status">{t("pc_not_ready")}</p>}
      <button type="button" className={`btn ${result?.ready ? "" : "primary"} big`} disabled={running || disabled} onClick={run}>
        {running ? t("dev_checking") : result ? t("pc_again") : t("dev_check")}
      </button>
    </section>
  );
}
