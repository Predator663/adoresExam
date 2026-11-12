/** Small sound effects made with the phone's own sound chip (no files to download). They respect the student's Sound switch
 *  (the same "amani_sound" choice the exam screen uses) and stay quiet and short. Browsers allow sound only after a tap or click,
 *  which is always the case here because every effect starts from a finger or mouse action. */
let ctx: AudioContext | null = null;
export const soundOn = () => { try { return localStorage.getItem("amani_sound") !== "off"; } catch { return true; } };

function ac(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    ctx = ctx || new Ctx();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(freq: number, dur: number, vol: number, opts: { to?: number; type?: OscillatorType; at?: number } = {}) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + (opts.at || 0), osc = a.createOscillator(), gain = a.createGain();
  osc.type = opts.type || "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* not on every phone */ } };

export const sfx = {
  /** an item is picked up: a soft rising "pop" */
  pick() { buzz(10); if (soundOn()) { tone(420, 0.09, 0.07, { to: 700 }); tone(840, 0.05, 0.03, { at: 0.03, type: "triangle" }); } },
  /** the item passes another one: a tiny tick */
  tick() { buzz(5); if (soundOn()) tone(1000, 0.035, 0.04, { type: "triangle" }); },
  /** the item is put down: a soft thud and two bright notes */
  drop() { buzz(14); if (soundOn()) { tone(170, 0.13, 0.11, { to: 80 }); tone(660, 0.12, 0.05, { at: 0.05 }); tone(990, 0.2, 0.04, { at: 0.1 }); } },
};
