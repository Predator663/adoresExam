"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GpsSteps } from "@/components/GpsHelp";
import { api } from "@/lib/api";
import { BLOCKING, diagnose, readEnv, type GpsReason, type PhoneOS } from "@/lib/gps";
import { getBestFix, lastGeoDetail, startMotion, type Fix, type FixError } from "@/lib/proctor";
import { useSession } from "@/lib/session";

/** Optional "Check my location" box. Only Location (GPS) is looked at: Wi-Fi and Bluetooth are NOT required and NOT checked.
 *
 *  Location is OPTIONAL: whether it is on or off, the student can start the exam. This box only helps her turn it on (a page cannot
 *  switch GPS on, only the phone's owner can) and explains, in Swahili, why it matters. Asking for the position is what makes the
 *  phone ask for location permission and wake its GPS. */

type Row = "idle" | "checking" | "ok" | "info" | "bad";
export type PhoneResult = { ready: boolean; fix?: Fix; gps: "ok" | GpsReason };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const atLeast = (since: number, ms: number) => pause(Math.max(0, ms - (Date.now() - since)));  // the step stays on screen long enough to be seen

const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
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
  const [row, setRow] = useState<Row>("idle"), [text, setText] = useState("");
  const [running, setRunning] = useState(false), [result, setResult] = useState<PhoneResult | null>(null);
  const [os, setOs] = useState<PhoneOS>("other"), [acc, setAcc] = useState<number | undefined>();
  const busy = useRef(false), gpsFailed = useRef(false), ran = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; ran.current = true;
    setRunning(true); setResult(null); onChange(null);
    setRow("checking"); setText(t("pc_gps_run"));
    try {
      await startMotion().catch(() => {});  // on iPhone this is the moment iOS asks for the motion sensor (it needs this tap)
      const env = await readEnv(); setOs(env.os);
      const t0 = Date.now();
      let fix: Fix | undefined, err: FixError | undefined;
      try { fix = await getBestFix(20000, 15, 4000); } catch (e) { err = e as FixError; }
      await atLeast(t0, 1500);
      const reason = diagnose(err, env, lastGeoDetail(), fix?.accuracy);
      const gpsOk = !!fix && !(reason && BLOCKING.includes(reason));
      gpsFailed.current = !gpsOk; setAcc(fix?.accuracy);
      const gpsWord: PhoneResult["gps"] = gpsOk ? (reason === "weak" ? "weak" : "ok") : (reason || "unknown");
      setRow(gpsOk ? (reason === "weak" ? "info" : "ok") : "bad");
      setText(gpsOk ? t(reason === "weak" ? "pc_gps_weak" : "pc_gps_ok", { n: Math.round(fix!.accuracy) }) : t(`gps_r_${gpsWord}`));

      const res: PhoneResult = { ready: true, fix: gpsOk ? fix : undefined, gps: gpsWord === "weak" ? "ok" : gpsWord };  // always ready: Location is optional
      setResult(res); onChange(res);
      if (!gpsOk || reason === "weak") {  // tell the school WHY, so a teacher can help (once per reason, kept in the audit log)
        api(`/student/exams/${examId}/device-check/`, { body: { gps: gpsWord === "weak" ? "weak" : res.gps, os: env.os } }).catch(() => {});
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

  const showGps = result && (row === "bad" || row === "info");
  return (
    <section className={`pc ${row === "ok" ? "ready" : ""}`} aria-labelledby="pc-h">
      <h2 id="pc-h">📍 {t("dev_title")}</h2>
      <div className="hint" role="note"><b>{t("loc_why_title")}</b> {t("loc_why")}</div>
      <ol className="pc-list" aria-live="polite">
        <li className={`pc-row ${row}`}>
          <span className="pc-ico" aria-hidden><i className="pc-ring" /><i className="pc-ring r2" /><PinIcon /></span>
          <span className="pc-txt"><b>{t("dev_location")}</b><span>{text || t("pc_idle")}</span></span>
          <span className="pc-st" aria-hidden><State s={row} /></span>
        </li>
      </ol>

      {showGps && <GpsSteps reason={(result!.gps === "ok" ? "weak" : result!.gps) as GpsReason} os={os} accuracy={acc} />}
      {result && row === "bad" && <p className="muted small" role="status">{t("pc_optional_note")}</p>}
      <button type="button" className="btn big" disabled={running || disabled} onClick={run}>
        {running ? t("dev_checking") : result ? t("pc_again") : t("dev_check")}
      </button>
    </section>
  );
}
