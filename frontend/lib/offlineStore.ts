/** Offline use: where downloaded data lives on the phone. No imports from api.ts, so api.ts can read saved copies
 *  when the network is down without a circular import.
 *  - Files of the app itself (pages, scripts, styles): Cache Storage "amani-offline-static". Nothing private in there.
 *  - The student's own data (results, answers, practice questions): Cache Storage "amani-user-data", under
 *    /__offline__/..., removed when she logs out or another person logs in on the same phone. */
export const STATIC_CACHE = "amani-offline-static";
export const DATA_CACHE = "amani-user-data";
const INDEX = "amani_offline_index";
const UID = "amani_current_uid";

export type Entry = { at: string; count: number; bytes: number };
export type PackEntry = Entry & { name: string; expires: string };
export type Index = { uid: string; files?: Entry; exams?: Entry; results?: Entry; practice: Record<string, PackEntry> };

export const supported = () => typeof window !== "undefined" && "caches" in window;

export function readIndex(): Index | null {
  try { const i = JSON.parse(localStorage.getItem(INDEX) || "null"); return i && typeof i === "object" ? i : null; } catch { return null; }
}
export function writeIndex(i: Index) { try { localStorage.setItem(INDEX, JSON.stringify(i)); } catch { /* storage full */ } }
export const currentUid = () => { try { return localStorage.getItem(UID) || ""; } catch { return ""; } };
export const dataKey = (apiPath: string) => `${location.origin}/__offline__/api${apiPath.split("?")[0]}`;

/** The saved copy of an API answer, or undefined. Only for the person who downloaded it. */
export async function offlineGet(path: string): Promise<any | undefined> {
  try {
    if (!supported()) return undefined;
    const idx = readIndex();
    if (!idx || !idx.uid || idx.uid !== currentUid()) return undefined;
    const hit = await (await caches.open(DATA_CACHE)).match(dataKey(path));
    return hit ? await hit.json() : undefined;
  } catch { return undefined; }
}

/** Private downloads leave the phone when she logs out, or when somebody else signs in here. */
export async function clearOfflineData() {
  try { localStorage.removeItem(INDEX); } catch { /* ignore */ }
  try { if (supported()) await caches.delete(DATA_CACHE); } catch { /* ignore */ }
}
export function setCurrentUser(uid: number | string) {
  try {
    localStorage.setItem(UID, String(uid));
    const idx = readIndex();
    if (idx && idx.uid !== String(uid)) clearOfflineData();
  } catch { /* ignore */ }
}
