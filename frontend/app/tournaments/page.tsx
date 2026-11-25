"use client";
import { useEffect, useState } from "react";
import { Detail, Hub } from "@/components/tournament";
import Shell from "@/components/Shell";
import { useSession } from "@/lib/session";

/** 1v1 tournaments with a classmate, played at different times. The page address is /tournaments/ or /tournaments/?id=5. */
export default function Tournaments() {
  const { lang } = useSession();
  const [id, setId] = useState<number | null>(null), [ready, setReady] = useState(false), [key, setKey] = useState(0);
  useEffect(() => { const n = Number(new URLSearchParams(location.search).get("id")); setId(n > 0 ? n : null); setReady(true); }, []);
  useEffect(() => { const on = (e: Event) => go(Number((e as CustomEvent).detail) || null); window.addEventListener("amani:tn-open", on); return () => window.removeEventListener("amani:tn-open", on); }); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (to: number | null) => { history.replaceState(null, "", to ? `/tournaments/?id=${to}` : "/tournaments/"); setId(to); setKey((k) => k + 1); window.scrollTo({ top: 0 }); };
  return (
    <Shell title={lang === "sw" ? "Mashindano" : "Tournaments"}>
      {ready && (id ? <Detail key={`${id}:${key}`} id={id} back={() => go(null)} rematch={() => go(null)} /> : <Hub key={key} open={(n) => go(n)} />)}
    </Shell>
  );
}
