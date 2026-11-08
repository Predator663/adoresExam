"use client";
/* Why is Location (GPS) not working on this phone, and how does the student fix it?
 *
 * A web page cannot switch GPS, Wi-Fi or Bluetooth on: only the person can, in the phone's settings. What the page CAN do is find out
 * as much as the browser reveals (secure page? in-app browser? permission state? which error code came back?) and say the likely
 * reason in plain words with the exact steps for her kind of phone. The reasons below are the real, distinguishable cases:
 *
 *   insecure      the page is not https, so phones never share location with it
 *   unsupported   this browser has no location feature at all
 *   in_app        opened inside WhatsApp / Facebook / Instagram ... whose mini-browser usually blocks location
 *   policy        the browser or a school/work device policy disables location for the page
 *   site_denied   permission refused (she tapped "Don't allow", or location is blocked for the browser app in phone settings)
 *   services_off  the phone's Location switch is off, or the phone cannot work out where it is
 *   no_signal     no position within 20 seconds (weak signal, battery saver, deep inside a building)
 *   weak          a position was found, but only roughly (more than 1 km off)
 *   unknown       something else
 */
import type { FixError } from "@/lib/proctor";

export type GpsReason = "insecure" | "unsupported" | "in_app" | "policy" | "site_denied" | "services_off" | "no_signal" | "weak" | "unknown";
export type PhoneOS = "android" | "ios" | "other";
export type Env = { os: PhoneOS; inApp: boolean; secure: boolean; perm: "granted" | "denied" | "prompt" | "unknown" };
export type GeoDetail = { code?: number; message?: string };

export const WEAK_METRES = 1000;

export function detectOS(ua: string): PhoneOS {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return "ios";
  return "other";
}

/** Mini-browsers inside other apps. They often refuse location, so the fix is "open it in Chrome / Safari". */
export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|Telegram|MicroMessenger|; wv\)|GSA\//i.test(ua);
}

export async function readEnv(): Promise<Env> {
  const nav: any = typeof navigator === "undefined" ? {} : navigator;
  const ua: string = nav.userAgent || "";
  let perm: Env["perm"] = "unknown";
  try {
    const s = (await nav.permissions?.query({ name: "geolocation" }))?.state;
    if (s === "granted" || s === "denied" || s === "prompt") perm = s;
  } catch { /* some browsers do not support asking */ }
  return { os: detectOS(ua), inApp: isInAppBrowser(ua), secure: typeof window === "undefined" ? true : window.isSecureContext !== false, perm };
}

/** The most likely reason, from what the browser told us. `accuracy` (metres) is only given when a position DID come back. */
export function diagnose(err: FixError | undefined, env: Env, detail: GeoDetail = {}, accuracy?: number): GpsReason | null {
  if (!err) return accuracy !== undefined && accuracy > WEAK_METRES ? "weak" : null;  // null = location works
  if (!env.secure) return "insecure";
  if (err === "unsupported") return env.inApp ? "in_app" : "unsupported";
  if (/permissions?[- ]policy|disabled in this document|feature policy/i.test(detail.message || "")) return "policy";
  if (err === "denied") return env.inApp ? "in_app" : "site_denied";
  if (err === "unavailable") return "services_off";
  if (err === "timeout") return "no_signal";
  return "unknown";
}

/** i18n keys for the steps: a phone-specific list if there is one, else the general one. Steps are separated by a line break. */
export function stepsKey(reason: GpsReason, os: PhoneOS, has: (k: string) => boolean): string {
  const specific = `gps_fix_${reason}_${os}`;
  return has(specific) ? specific : `gps_fix_${reason}`;
}

/** Reasons the student can fix herself and then retry; the check keeps the Start button locked for all of them except "weak". */
export const BLOCKING: GpsReason[] = ["insecure", "unsupported", "in_app", "policy", "site_denied", "services_off", "no_signal", "unknown"];
