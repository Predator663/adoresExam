"use client";
import { useEffect, useState } from "react";
import { diagnose, readEnv, stepsKey, type Env, type GpsReason, type PhoneOS } from "@/lib/gps";
import { lastGeoDetail, type FixError } from "@/lib/proctor";
import { useSession } from "@/lib/session";

/** A numbered list from text whose steps are separated by line breaks. */
export function Steps({ text }: { text: string }) {
  const items = text.split("\n").map((s) => s.trim()).filter(Boolean);
  return <ol className="gh-steps">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

/** What is wrong with Location, why, and how to fix it on this kind of phone. */
export function GpsSteps({ reason, os, accuracy }: { reason: GpsReason; os: PhoneOS; accuracy?: number }) {
  const { t } = useSession();
  const has = (k: string) => t(k) !== k;
  return (
    <div className={`gh ${reason === "weak" ? "warn" : "bad"}`} role="group" aria-label={t(`gps_r_${reason}`)}>
      <p className="gh-title"><b>{reason === "weak" ? "ⓘ" : "⚠"} {t(`gps_r_${reason}`)}</b></p>
      <p className="gh-why">{t(`gps_w_${reason}`, { n: Math.round(accuracy || 0) })}</p>
      <p className="gh-how"><b>{t("gps_how")}</b></p>
      <Steps text={t(stepsKey(reason, os, has))} />
    </div>
  );
}

/** For screens that only know the error word (the exam screen while the exam runs): find out the phone's details, then explain. */
export default function GpsHelp({ error }: { error: FixError }) {
  const [env, setEnv] = useState<Env | null>(null);
  useEffect(() => { readEnv().then(setEnv); }, []);
  if (!env) return null;
  const reason = diagnose(error, env, lastGeoDetail()) || "unknown";
  return <GpsSteps reason={reason} os={env.os} />;
}
