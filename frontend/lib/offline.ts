/** Offline use (PWA): downloads with true progress.
 *  Progress is never faked: it is bytes received (when the server says how big a file is) inside a count of files, questions
 *  or results finished. Exam questions are NEVER downloaded ahead of time: they are sent only when an exam starts. */
import { API, getToken, mediaUrl, schoolHost } from "./api";
import { DATA_CACHE, Entry, Index, PackEntry, STATIC_CACHE, currentUid, dataKey, readIndex, supported, writeIndex } from "./offlineStore";
import type { PackQuestion } from "./marking";

export type Progress = { fraction: number; done: number; total: number; bytes: number };
export type Report = (p: Progress) => void;
export class Cancelled extends Error { constructor() { super("cancelled"); } }

/** Every screen of the app. Their HTML is fetched, then the scripts and styles each one names. */
const PAGES = ["/", "/login/", "/exam/", "/results/", "/result/", "/review/", "/practice/", "/badges/", "/progress/", "/leaderboard/",
  "/notifications/", "/messages/", "/settings/", "/install/", "/demo/", "/change-password/", "/about/", "/privacy/", "/terms/", "/accessibility/"];
const EXTRA = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/logo.png", "/operator/cratos.jpg"];
const ASSET = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[A-Za-z0-9_\-.\/%~\[\]]+?\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp)/g;
const MEDIA = /(?:https?:\/\/[^"'\\\s<>)]+)?\/media\/[^"'\\\s<>)]+/g;

const authHeaders = (): Record<string, string> => ({ Authorization: `Token ${getToken()}`, "X-School": schoolHost() });
const nowIso = () => new Date().toISOString();

/** Read a response while counting bytes, so a progress bar can follow it. */
async function pull(url: string, init: RequestInit, signal: AbortSignal | undefined, onBytes?: (got: number, size: number) => void): Promise<{ blob: Blob; type: string }> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal }); } catch (e: any) { if (e?.name === "AbortError") throw new Cancelled(); throw e; }
  if (!res.ok) throw new Error(`${res.status}`);
  const size = Number(res.headers.get("content-length")) || 0, type = res.headers.get("content-type") || "";
  if (!res.body) { const blob = await res.blob(); onBytes?.(blob.size, blob.size); return { blob, type }; }
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length; onBytes?.(got, size);
    }
  } catch (e: any) { if (e?.name === "AbortError") throw new Cancelled(); throw e; }
  return { blob: new Blob(parts as BlobPart[], { type }), type };
}

/** Steps finished + the fraction of each step in flight, over the total number of steps. */
function tracker(total: number, report: Report) {
  let done = 0, bytes = 0, seq = 0;
  const live = new Map<number, number>();
  const emit = () => report({ fraction: Math.min(1, (done + [...live.values()].reduce((a, b) => a + b, 0)) / Math.max(1, total)), done, total, bytes });
  return {
    emit, bytes: () => bytes,
    skip() { done++; emit(); },
    begin() {
      const id = ++seq; let last = 0; live.set(id, 0);
      return {
        onBytes(got: number, size: number) { bytes += got - last; last = got; live.set(id, size ? Math.min(0.99, got / size) : 0); emit(); },
        end() { live.delete(id); done++; emit(); },
        fail() { live.delete(id); },
      };
    },
  };
}

/** Run `fn` over `items`, `n` at a time. The first failure stops the rest. */
async function pool<T>(items: T[], n: number, signal: AbortSignal | undefined, fn: (x: T) => Promise<void>) {
  let i = 0, failed: any = null;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (!failed && i < items.length) {
      if (signal?.aborted) throw new Cancelled();
      try { await fn(items[i++]); } catch (e) { failed = failed || e; }
    }
  }));
  if (failed) throw failed;
}

const mapProgress = (report: Report, from: number, to: number): Report => (p) => report({ ...p, fraction: from + (to - from) * p.fraction });

function mutate(fn: (i: Index) => void) {
  let idx = readIndex();
  if (!idx || idx.uid !== currentUid()) idx = { uid: currentUid(), practice: {} };
  fn(idx); writeIndex(idx);
}

async function saveJson(path: string, signal: AbortSignal | undefined, onBytes?: (got: number, size: number) => void): Promise<{ data: any; text: string }> {
  const { blob } = await pull(`${API}/api${path}`, { headers: authHeaders() }, signal, onBytes);
  const text = await blob.text();
  await (await caches.open(DATA_CACHE)).put(dataKey(path), new Response(text, { headers: { "content-type": "application/json" } }));
  return { data: JSON.parse(text), text };
}

/** Pictures inside questions (served by the API under /media/). Saved so they show with no signal too. */
async function saveImages(texts: string[], signal: AbortSignal | undefined, report: Report) {
  const urls = [...new Set(texts.flatMap((t) => t.match(MEDIA) || []).map((u) => mediaUrl(u)))];
  if (!urls.length) return report({ fraction: 1, done: 0, total: 0, bytes: 0 });
  const cache = await caches.open(DATA_CACHE), tr = tracker(urls.length, report);  // with her private data: removed when she logs out
  await pool(urls, 3, signal, async (u) => {
    const step = tr.begin();
    try {
      const same = new URL(u, location.href).origin === location.origin;
      const res = await fetch(u, { mode: same ? "same-origin" : "no-cors", signal });
      if (res.ok || res.type === "opaque") await cache.put(u, res.clone());
      step.end();
    } catch (e: any) { step.fail(); if (e?.name === "AbortError") throw new Cancelled(); step.end(); /* one missing picture must not fail a download */ }
  });
}

// ------------------------------------------------------------------------------------------------ app files

export async function downloadFiles(report: Report, signal?: AbortSignal): Promise<void> {
  const cache = await caches.open(STATIC_CACHE);
  const assets = new Set<string>();
  let bytes = 0, failedPages = 0;

  // 1) the pages themselves (this tells us which scripts and styles they need)
  const pageTracker = tracker(PAGES.length, mapProgress(report, 0, 0.2));
  await pool(PAGES, 4, signal, async (path) => {
    const step = pageTracker.begin();
    try {
      const { blob, type } = await pull(path, { cache: "reload" }, signal, (g, s) => step.onBytes(g, s));
      const html = await blob.text();
      (html.match(ASSET) || []).forEach((u) => assets.add(u.startsWith("/_next/") ? u : `/_next/${u}`));
      await cache.put(new Request(location.origin + path), new Response(blob, { headers: { "content-type": type || "text/html" } }));
      step.end();
    } catch (e) { if (e instanceof Cancelled) throw e; failedPages++; step.fail(); pageTracker.skip(); }
  });
  bytes += pageTracker.bytes();
  if (failedPages === PAGES.length) throw new Error("pages");

  // 2) scripts, styles, fonts and icons. Built files have fixed names, so one already on the phone is not downloaded again.
  const files = [...assets, ...EXTRA];
  const tr = tracker(files.length, mapProgress(report, 0.2, 1));
  let failed = 0;
  await pool(files, 5, signal, async (path) => {
    const key = location.origin + path;
    if (path.startsWith("/_next/static/") && (await cache.match(key))) return tr.skip();
    const step = tr.begin();
    try {
      const { blob, type } = await pull(path, {}, signal, (g, s) => step.onBytes(g, s));
      await cache.put(new Request(key), new Response(blob, { headers: { "content-type": type } }));
      step.end();
    } catch (e) { if (e instanceof Cancelled) throw e; failed++; step.fail(); tr.skip(); }
  });
  bytes += tr.bytes();
  if (failed) throw new Error(`${failed}`);
  mutate((i) => { i.files = { at: nowIso(), count: PAGES.length + files.length, bytes }; });
  report({ fraction: 1, done: files.length, total: files.length, bytes });
}

// ------------------------------------------------------------------------------------------------ exam timetable and rules

export async function downloadExams(report: Report, signal?: AbortSignal): Promise<void> {
  const paths = ["/student/exams/", "/results/pending/"];
  const tr = tracker(paths.length, report);
  for (const p of paths) {
    const step = tr.begin();
    await saveJson(p, signal, (g, s) => step.onBytes(g, s));
    step.end();
  }
  mutate((i) => { i.exams = { at: nowIso(), count: paths.length, bytes: tr.bytes() }; });
}

// ------------------------------------------------------------------------------------------------ results and answer review

export async function downloadResults(report: Report, signal?: AbortSignal): Promise<void> {
  const list = (await saveJson("/results/", signal)).data;
  const rows: any[] = (Array.isArray(list) ? list : list?.results || []).slice(0, 30);
  const ids: number[] = rows.map((r) => r.attempt_id);
  const texts: string[] = [];
  const tr = tracker(Math.max(1, ids.length * 2), mapProgress(report, 0, 0.85));
  let bytes = 0;
  if (!ids.length) tr.emit();
  await pool(ids, 3, signal, async (id) => {
    for (const p of [`/results/${id}/`, `/results/${id}/review/`]) {
      const step = tr.begin();
      try { texts.push((await saveJson(p, signal, (g, s) => step.onBytes(g, s))).text); step.end(); }
      catch (e) { step.fail(); throw e; }
    }
  });
  bytes += tr.bytes();
  await saveImages(texts, signal, mapProgress(report, 0.85, 1));
  mutate((i) => { i.results = { at: nowIso(), count: ids.length, bytes, ids } as Entry; });
  report({ fraction: 1, done: ids.length, total: ids.length, bytes });
}

// ------------------------------------------------------------------------------------------------ practice questions

const BATCH = 10;

export async function downloadPractice(subjectId: number, name: string, report: Report, signal?: AbortSignal): Promise<void> {
  const base = `/practice/pack/${subjectId}/`;
  const head = (await saveJson(`${base}?limit=0`, signal)).data;  // how many questions, and which ones (seed)
  const total: number = head.count, questions: PackQuestion[] = [], texts: string[] = [];
  let bytes = 0;
  for (let off = 0; off < total; off += BATCH) {
    if (signal?.aborted) throw new Cancelled();
    const { data, text } = await saveJson(`${base}?seed=${head.seed}&offset=${off}&limit=${BATCH}`, signal);
    bytes += text.length; texts.push(text);
    questions.push(...data.questions);
    report({ fraction: 0.85 * Math.min(1, questions.length / total), done: questions.length, total, bytes });
  }
  const pack = { subject_id: head.subject_id, subject: head.subject, created_at: head.created_at, expires_at: head.expires_at, count: questions.length, questions };
  await (await caches.open(DATA_CACHE)).put(dataKey(base), new Response(JSON.stringify(pack), { headers: { "content-type": "application/json" } }));
  await saveImages(texts, signal, mapProgress((p) => report({ ...p, done: questions.length, total, bytes }), 0.85, 1));
  mutate((i) => { i.practice[String(subjectId)] = { name, at: nowIso(), count: questions.length, bytes, expires: head.expires_at }; });
  report({ fraction: 1, done: questions.length, total, bytes });
}

/** A downloaded pack for offline quizzes, or null (none saved, expired, or saved by somebody else). */
export async function readPack(subjectId: number | string): Promise<{ subject: string; count: number; questions: PackQuestion[]; expires_at: string } | null> {
  try {
    const idx = readIndex();
    if (!supported() || !idx || idx.uid !== currentUid()) return null;
    const hit = await (await caches.open(DATA_CACHE)).match(dataKey(`/practice/pack/${subjectId}/`));
    if (!hit) return null;
    const p = await hit.json();
    return new Date(p.expires_at).getTime() > Date.now() ? p : null;
  } catch { return null; }
}

export function listPacks(): { id: string; entry: PackEntry; expired: boolean }[] {
  const idx = readIndex();
  if (!idx || idx.uid !== currentUid()) return [];
  return Object.entries(idx.practice || {}).map(([id, entry]) => ({ id, entry, expired: new Date(entry.expires).getTime() <= Date.now() }));
}

// ------------------------------------------------------------------------------------------------ removing

export async function removeKind(kind: "files" | "exams" | "results" | "practice", id?: string) {
  if (!supported()) return;
  const idx = readIndex();
  if (kind === "files") {
    await caches.delete(STATIC_CACHE);
    if (idx) { delete idx.files; writeIndex(idx); }
    return;
  }
  if (!idx) return;
  const data = await caches.open(DATA_CACHE);
  if (kind === "exams") { for (const p of ["/student/exams/", "/results/pending/"]) await data.delete(dataKey(p)); delete idx.exams; }
  if (kind === "results") {
    const ids: number[] = (idx.results as any)?.ids || [];
    for (const p of ["/results/", ...ids.flatMap((i) => [`/results/${i}/`, `/results/${i}/review/`])]) await data.delete(dataKey(p));
    delete idx.results;
  }
  if (kind === "practice" && id) { await data.delete(dataKey(`/practice/pack/${id}/`)); await data.delete(dataKey(`/practice/pack/${id}/?limit=0`)); delete idx.practice[id]; }
  writeIndex(idx);
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e && e.quota ? { used: e.usage || 0, quota: e.quota } : null; } catch { return null; }
}

export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
