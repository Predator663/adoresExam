"use client";
import { api } from "./api";
import { useSession } from "./session";
import { useSwr } from "./swr";

type Opts<T> = { age?: (data: T, ageMs: number) => T };

/** The signed-in person's own data at `path`, shown from the last copy at once and refreshed quietly (see useSwr). */
export function useMine<T = any>(path: string | null, opts: Opts<T> = {}) {
  const { user } = useSession();
  return useSwr<T>(path && user ? `${user.id}:${path}` : null, () => api<T>(path!), opts);
}

