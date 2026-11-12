"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** "Show what we had, refresh quietly." The last answer for a key is kept in sessionStorage (this tab only, gone when the tab closes),
 *  so going back to a screen shows it at once instead of a skeleton, and the fresh answer replaces it without a flash.
 *  `loading` is true only while there is nothing at all to show; `refreshing` is the quiet background refresh.
 *  `age(data, ms)` lets a caller correct values that go stale with time (for example the server clock on an exam card). */
type Opts<T> = { age?: (data: T, ageMs: number) => T };
const PREFIX = "amani_swr:";

function read<T>(key: string, age?: (d: T, ms: number) => T): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: T };
    return age ? age(data, Math.max(0, Date.now() - at)) : data;
  } catch { return null; }
}
function write(key: string, data: unknown) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data })); } catch { /* storage full or blocked: just no cache */ }
}

export function useSwr<T>(key: string | null, fn: () => Promise<T>, opts: Opts<T> = {}) {
  // the cached answer is read while the first render is built, so there is no skeleton frame before it
  const [data, setData] = useState<T | null>(() => (key && typeof window !== "undefined" ? read<T>(key, opts.age) : null));
  const [error, setError] = useState("");
  const [err, setErr] = useState<any>(null);
  const [loading, setLoading] = useState(() => data === null);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn); fnRef.current = fn;
  const ageRef = useRef(opts.age); ageRef.current = opts.age;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback((quiet: boolean) => {
    setRefreshing(true); setError(""); setErr(null);
    if (!quiet) setLoading(true);
    fnRef.current()
      .then((d) => { if (!alive.current) return; setData(d); if (key) write(key, d); })
      .catch((e) => { if (!alive.current) return; setError(e?.message || "Error"); setErr(e); })
      .finally(() => { if (!alive.current) return; setLoading(false); setRefreshing(false); });
  }, [key]);

  useEffect(() => {
    const cached = key ? read<T>(key, ageRef.current) : null;
    if (cached) { setData(cached); setLoading(false); run(true); } else run(false);
  }, [key, run]);

  // a failed quiet refresh must not hide what we are already showing
  return { data, error: data ? "" : error, err, loading: loading && !data, refreshing, reload: () => run(!!data), setData };
}
