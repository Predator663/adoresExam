"use client";
/* Anti-cheat support on the student's phone (proximity check, see the Privacy policy, section "Location during exams").
 *
 * What a web app can and cannot do, honestly:
 *  - Location: navigator.geolocation. With "high accuracy" the phone's operating system fuses GNSS (GPS), Wi-Fi positioning and
 *    mobile-network positioning by itself. A web page cannot read those sources separately, it only receives the fused position
 *    and its accuracy in metres. This is the real position source.
 *  - Motion: the accelerometer through DeviceMotionEvent. It only tells whether the phone itself is being moved.
 *  - Wi-Fi and Bluetooth are NOT required and NOT read. Location itself is OPTIONAL: the exam can be started and written with it off.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

export type Fix = { lat: number; lng: number; accuracy: number; speed?: number | null; heading?: number | null };
export type Sensors = { perm?: string; motion?: string };
export type FixError = "denied" | "unavailable" | "timeout" | "unsupported";

/** One position reading, or a short error word. */
/**
 * A random code this browser made for itself the first time (kept in its own storage; it is not a phone number, IMEI or anything
 * from the hardware). It only lets the school see if one student's exam is suddenly sent from another device.
 */
export function deviceId(): string {
  try {
    let id = localStorage.getItem("amani_device") || "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("amani_device", id);
    }
    return id;
  } catch { return ""; }  // storage blocked: the check is simply skipped for this phone
}

/** What the browser said the last time a position could not be had (error code and message). lib/gps.ts uses it to name the reason. */
let lastGeo: { code?: number; message?: string } = {};
export const lastGeoDetail = () => lastGeo;

/* ---- a steadier position: keep the readings of the last 15 s and report their weighted average ---------------------------------------
   One phone reading can be 10-30 m off indoors and jumps from one reading to the next. While the phone lies still, readings scatter around the
   true spot, so averaging them (the precise ones count much more, old ones fade) lands closer to it. A moving phone (speed above 0.8 m/s) or a
   reading far from the others is never averaged. The reported accuracy only improves a little, because errors of nearby readings are alike. */
type Sample = { t: number; lat: number; lng: number; acc: number; speed: number | null; heading: number | null };
let samples: Sample[] = [], watchId: number | null = null, lastUse = 0;
const WINDOW_MS = 15000, M_LAT = 111_320;

function addSample(p: GeolocationPosition) {
  samples.push({ t: Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading });
  const cut = Date.now() - WINDOW_MS; samples = samples.filter((s) => s.t >= cut).slice(-30);
}

function fused(now: number): Fix | null {
  const live = samples.filter((s) => now - s.t <= WINDOW_MS);
  if (!live.length) return null;
  const L = live[live.length - 1];
  if ((L.speed ?? 0) > 0.8) return { lat: L.lat, lng: L.lng, accuracy: L.acc, speed: L.speed, heading: L.heading };
  const cosl = Math.cos((L.lat * Math.PI) / 180);
  const near = live.filter((s) => Math.hypot((s.lat - L.lat) * M_LAT, (s.lng - L.lng) * M_LAT * cosl) <= Math.max(2 * Math.max(s.acc, L.acc), 8));
  let w = 0, la = 0, ln = 0, w0 = 0, best = Infinity;
  for (const s of near) {
    const a = Math.max(s.acc, 3), k = Math.pow(0.5, (now - s.t) / 6000) / (a * a);  // precise and recent readings count most
    w += k; la += k * s.lat; ln += k * s.lng; w0 += 1 / (a * a); best = Math.min(best, a);
  }
  return { lat: la / w, lng: ln / w, accuracy: Math.max(3, 0.6 * best, 1 / Math.sqrt(w0)), speed: L.speed, heading: L.heading };
}

/** Keep listening to the phone's location while the exam page is open (stops by itself 90 s after the last use). */
export function startWatch() {
  if (typeof navigator === "undefined" || !navigator.geolocation || watchId != null) return;
  lastUse = Date.now();
  watchId = navigator.geolocation.watchPosition(
    (p) => { lastGeo = {}; addSample(p); if (Date.now() - lastUse > 90_000) stopWatch(); },
    (e) => { lastGeo = { code: e.code, message: e.message }; if (e.code === 1) stopWatch(); },  // a timeout here is normal; getFix reports real failures
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}
export function stopWatch() { if (watchId != null) navigator.geolocation?.clearWatch(watchId); watchId = null; samples = []; }

/** The first good position for START and the phone check: waits up to `settleMs` for the accuracy to reach `targetM` metres. */
export async function getBestFix(timeoutMs = 15000, targetM = 15, settleMs = 4000): Promise<Fix> {
  startWatch();
  let fix = await getFix(timeoutMs);
  const until = Date.now() + settleMs;
  while (fix.accuracy > targetM && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 600));
    fix = (fused(Date.now()) ?? fix);
  }
  return fix;
}

export function getFix(timeoutMs = 15000, maxAgeMs = 0): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { lastGeo = {}; return reject("unsupported" as FixError); }
    lastUse = Date.now();
    const ready = watchId != null ? fused(Date.now()) : null;
    if (ready) return resolve(ready);  // the running watch already has readings from the last 15 s
    navigator.geolocation.getCurrentPosition(
      (p) => { lastGeo = {}; if (watchId != null) addSample(p); resolve((watchId != null ? fused(Date.now()) : null) ?? { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading }); },
      (e) => { lastGeo = { code: e.code, message: e.message }; reject((e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable") as FixError); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maxAgeMs },
    );
  });
}

/* ---- motion: rolling spread of the acceleration over ~3 s. A phone lying on a desk has almost none. ---- */
let motionState: "unknown" | "denied" | "unsupported" | "still" | "moving" = "unknown";
let motionOn = false;
const win: number[] = [];

function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  win.push(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z));
  if (win.length > 45) win.shift();  // ~3 s at 15 Hz
  if (win.length < 15) return;
  const m = win.reduce((s, v) => s + v, 0) / win.length;
  const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) ** 2, 0) / win.length);
  motionState = sd > 1.1 ? "moving" : "still";
}

/** Start listening. On iPhone this must run from a tap, because iOS asks the student for permission. */
export async function startMotion(): Promise<string> {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return (motionState = "unsupported");
  if (motionOn) return motionState;
  try {
    const D: any = (window as any).DeviceMotionEvent;
    if (typeof D.requestPermission === "function") {
      if ((await D.requestPermission()) !== "granted") return (motionState = "denied");
    }
  } catch { return (motionState = "denied"); }
  window.addEventListener("devicemotion", onMotion);
  motionOn = true;
  return motionState === "unknown" ? "still" : motionState;
}

export async function readSensors(): Promise<Sensors> {
  const s: Sensors = { motion: motionState };
  const nav: any = typeof navigator === "undefined" ? {} : navigator;
  try { s.perm = (await nav.permissions?.query({ name: "geolocation" }))?.state ?? "unknown"; } catch { s.perm = "unknown"; }
  return s;
}

export type ProctorState = "starting" | "ok" | "denied" | "lost";

/** While an exam attempt is running: send the position every few seconds, and tell the page when location is switched off. */
export function useProctor(attemptId: number | null, every = 6000) {
  const [state, setState] = useState<ProctorState>("starting");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locked, setLocked] = useState<boolean | null>(null);  // null = the server has not said yet
  const [lockReason, setLockReason] = useState<string>("");  // close | leaves | manual
  const lastMsgs = useRef(0);
  const markLocked = useCallback((reason = "") => { setLocked(true); if (reason) setLockReason(reason); }, []);
  const applyLock = useCallback((v: boolean, reason = "") => { setLocked(v); setLockReason(v ? reason : ""); }, []);
  const fails = useRef(0), stop = useRef(false), busy = useRef(false);

  const tick = useCallback(async () => {
    if (!attemptId || stop.current || busy.current) return;
    busy.current = true;
    try {
      const fix = await getFix(10000);
      fails.current = 0; setState("ok"); setAccuracy(Math.round(fix.accuracy));
      const sensors = await readSensors();
      try { const r = await api<{ locked?: boolean; lock_reason?: string; messages?: number }>(`/attempts/${attemptId}/location/`, { body: { ...fix, sensors, device: deviceId() } }); setLocked(!!r?.locked); setLockReason(r?.locked ? r?.lock_reason || "close" : "");
        const m = r?.messages ?? 0;
        if (m > lastMsgs.current) window.dispatchEvent(new Event("amani:messages"));  // a message from the school arrived: show its banner now
        lastMsgs.current = m; }
      catch (e) { if (e instanceof ApiError && e.code === "finished") stop.current = true; /* offline: the next report catches up */ }
    } catch (e) {
      // Location is optional: these states only show a small note, they never hide the questions. We keep trying, so the position
      // is sent again as soon as she switches Location on.
      if (e === "denied") setState("denied");
      else if (++fails.current >= 4) setState("lost");  // no position for ~30 s: services off or no sky view
    } finally { busy.current = false; }
  }, [attemptId]);

  useEffect(() => {
    if (!attemptId) return;
    stop.current = false; fails.current = 0; setState("starting");
    startMotion().catch(() => {});  // works on Android / already-granted iOS; otherwise motion stays "unknown", which is fine
    startWatch();  // continuous readings, averaged by getFix
    // The start request already sent a position, so the first report waits a random 1-5 s: hundreds of phones must not report in the same second.
    const first = setTimeout(tick, 1000 + Math.random() * 4000);
    const iv = setInterval(tick, every);
    const vis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop.current = true; stopWatch(); clearTimeout(first); clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [attemptId, every, tick]);

  /** `locked`: an administrator has to unlock this exam because the student sits too close to another one. The next report overrides `markLocked`. */
  return { state, accuracy, locked, lockReason, markLocked, applyLock, retry: tick };
}
