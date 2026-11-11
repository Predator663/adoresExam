import { useEffect, useState } from "react";

/** Data saver: pictures inside questions load only when the student taps them. A choice made on this phone (Settings),
 *  and switched on by default when the phone itself asks websites to save data. */
const KEY = "amani_data_saver";
export function dataSaverOn(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    return !!(navigator as any).connection?.saveData;
  } catch { return false; }
}
export function setDataSaver(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); window.dispatchEvent(new Event("amani:datasaver")); } catch { /* ignore */ }
}
export function useDataSaver(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(dataSaverOn());
    sync(); window.addEventListener("amani:datasaver", sync);
    return () => window.removeEventListener("amani:datasaver", sync);
  }, []);
  return on;
}

/** A small grey box with the words "Tap to load picture", shown instead of an image while Data saver is on. */
export function placeholderImage(label: string, w = 320, h = 140): string {
  const esc = label.replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" rx="10" fill="#e5e7eb" stroke="#9ca3af" stroke-dasharray="6 4"/><text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#374151">🖼</text><text x="50%" y="68%" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#374151">${esc}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
