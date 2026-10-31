"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";

/** Shown whenever the phone has no signal, so saved copies are never mistaken for live data. */
export default function OfflineBar() {
  const { t } = useSession();
  const [off, setOff] = useState(false);
  useEffect(() => {
    const sync = () => setOff(!navigator.onLine);
    sync();
    window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  return off ? <div className="off-bar" role="status">⚡ {t("off_banner")}</div> : null;
}
