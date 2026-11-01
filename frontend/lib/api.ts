/** "" = same address as the web page (development: Next.js forwards /api to Django). Otherwise the full address of the API. */
export const API = (process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "" : "http://localhost:8000")).replace(/\/$/, "");
export const apiBase = () => API || (typeof location !== "undefined" ? location.origin : "");
import { offlineGet } from "./offlineStore";
const TOKEN_KEY = "amani_token";

/** Which school this web app belongs to: its own address. One build of the web app serves every school; the API picks the school's data
 *  from this header (it must be registered as the school's address). NEXT_PUBLIC_SCHOOL_HOST forces another one, e.g. to test a school locally. */
export const schoolHost = () => process.env.NEXT_PUBLIC_SCHOOL_HOST || (typeof location !== "undefined" ? location.hostname : "");

export class ApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(message: string, status: number, code = "error", data: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
  /** status 0 = the phone could not reach the server (offline, or the server is down). */
  get isNetwork() { return this.status === 0; }
}

export const getToken = () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY));
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/** What people read when something goes wrong. Never a server address, a status code, a file name or a stack trace.
 *  The details go to the browser console (F12) for the developer. */
const WORDS = {
  en: { network: "Cannot connect right now. Check your internet and try again.", server: "Something went wrong on our side. Please try again in a moment.",
    generic: "Something went wrong. Please try again.", many: "Too many tries. Please wait a moment.", file: "The file is not available yet." },
  sw: { network: "Imeshindwa kuunganisha sasa. Angalia intaneti yako kisha jaribu tena.", server: "Hitilafu imetokea upande wetu. Tafadhali jaribu tena baada ya muda mfupi.",
    generic: "Hitilafu imetokea. Tafadhali jaribu tena.", many: "Umejaribu mara nyingi. Subiri kidogo.", file: "Faili bado haipatikani." },
};
export const words = () => {
  let l = "en";
  try { l = JSON.parse(localStorage.getItem("amani_prefs") || "{}").language || (navigator.language?.startsWith("sw") ? "sw" : "en"); } catch { /* English */ }
  return WORDS[l === "sw" ? "sw" : "en"];
};
/** A sentence meant for people, not a leaked technical message. */
const readable = (m: string) => m.length <= 300 && !/traceback|exception|error at|\.py\b|\.tsx?\b|<\/?[a-z][\s\S]*>|\bat 0x|django|psycopg|sql|undefined|\[object|stack/i.test(m);

function firstMessage(data: any, status: number): string {
  const w = words();
  if (status >= 500) return w.server;
  if (status === 429) return w.many;
  if (data && typeof data === "object") {
    const found = typeof data.detail === "string" ? data.detail : Object.values(data).map((v) => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "")).find(Boolean);
    if (found && readable(found)) return found;
  }
  return w.generic;
}

/** The message to show for ANY caught error, even one that is not an ApiError (a failed fetch, a bug in a script, ...). */
export function friendly(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (typeof console !== "undefined") console.warn("[app]", e);
  return !navigator.onLine ? words().network : words().generic;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; auth?: boolean; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-School": schoolHost() };
  const token = getToken();
  if (token && opts.auth !== false) headers.Authorization = `Token ${token}`;
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API}/api${path}`, {
      method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
      headers, body: opts.body === undefined ? undefined : isForm ? opts.body : JSON.stringify(opts.body), keepalive: opts.keepalive,
    });
  } catch {
    // No signal: a copy the person downloaded in Settings > Offline use is shown instead (reading only, her own data only).
    if (!opts.method || opts.method === "GET") { const saved = await offlineGet(path); if (saved !== undefined) return saved as T; }
    console.warn(`[app] cannot reach ${apiBase()}`);
    throw new ApiError(words().network, 0, "network");
  }
  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok && data === null && res.status >= 500) {
    // Not JSON from our API: a proxy or gateway answered because Django behind it is down or crashed.
    if (!opts.method || opts.method === "GET") { const saved = await offlineGet(path); if (saved !== undefined) return saved as T; }
    console.warn(`[app] cannot reach ${apiBase()}`);
    throw new ApiError(words().network, 0, "network");
  }
  if (!res.ok) {
    if (res.status === 503 && data?.code === "maintenance") window.dispatchEvent(new CustomEvent("amani:maintenance", { detail: data }));
    if (res.status === 401 && opts.auth !== false) window.dispatchEvent(new CustomEvent("amani:unauthorized"));
    if (res.status === 403 && data?.code === "password_change_required") window.dispatchEvent(new CustomEvent("amani:must-change-password"));
    throw new ApiError(firstMessage(data, res.status), res.status, data?.code || "error", data);
  }
  return data as T;
}

/** Download a file (PDF slip) with the login token, then hand it to the browser. */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${API}/api${path}`, { headers: { Authorization: `Token ${getToken()}`, "X-School": schoolHost() } });
  if (!res.ok) throw new ApiError(words().file, res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const mediaUrl = (u?: string | null) => (!u ? "" : /^https?:/i.test(u) ? u : `${API}${u.startsWith("/") ? "" : "/"}${u}`);
