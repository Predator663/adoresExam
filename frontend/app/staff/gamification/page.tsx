"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProfilePhoto } from "@/components/PhotoPicker";
import Shell from "@/components/Shell";
import { Bar, CountUp, ErrorNote, Modal, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { BADGE_EMOJI, TIER_MARK } from "@/lib/emoji";
import { eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";
import "./gm.css";

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** A student's photo, or her initials on a colour of her own. */
function Face({ name, photo, size, className = "" }: { name: string; photo?: string; size: number; className?: string }) {
  const ini = <span className={`gm-ini ${className}`} style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue(name)} 42% 36%)` }} aria-hidden>{initials(name)}</span>;
  return photo ? <ProfilePhoto photo={photo} fallback={ini} size={size} className="gm-face" /> : ini;
}

/* ------------------------------------------------------------------------------------------- podium */
function Podium({ top, open }: { top: any[]; open: (id: number) => void }) {
  if (!top.length) return <div className="card gm-empty"><span aria-hidden>🏆</span><h3>No XP yet</h3><p className="muted">The top three appear here as soon as students start earning XP.</p></div>;
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return (
    <section className="gm-podium" aria-label="Top three students by XP">
      {order.map((s) => (
        <button key={s.id} type="button" className={`gm-pod p${s.rank}`} onClick={() => open(s.id)} aria-label={`${s.name}, rank ${s.rank}, ${s.xp} XP. Open details`}>
          <span className="gm-crown" aria-hidden>{["👑", "🥈", "🥉"][s.rank - 1]}</span>
          <span className="gm-pod-face"><Face name={s.name} photo={s.photo} size={s.rank === 1 ? 92 : 72} /><i className="gm-shine" aria-hidden /></span>
          <b className="gm-pod-name">{s.name}</b>
          <small className="muted">{s.class || "—"}</small>
          <span className="gm-pod-xp"><CountUp to={s.xp} ms={1300} /> <small>XP</small></span>
          <span className="gm-chips"><i>Lv {s.level} · {s.level_name}</i><i>🏅 {s.badges}{s.gold ? ` (${s.gold} 🥇)` : ""}</i>{s.streak > 0 && <i>🔥 {s.streak}</i>}</span>
          <span className="gm-step" aria-hidden><span>{s.rank}</span></span>
        </button>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- charts */
function useReady() { const [r, setR] = useState(false); useEffect(() => { const h = requestAnimationFrame(() => setR(true)); return () => cancelAnimationFrame(h); }, []); return r; }

function Levels({ levels }: { levels: any[] }) {
  const ready = useReady(), max = Math.max(1, ...levels.map((l) => l.count));
  return (
    <div className="card gm-card">
      <h3>Levels</h3><p className="muted small">How many students are at each level.</p>
      <div className="gm-cols" role="img" aria-label={levels.map((l) => `${l.name}: ${l.count}`).join(", ")}>
        {levels.map((l, i) => (
          <div key={l.level} className="gm-col" title={`${l.name}: from ${l.from_xp} XP`}>
            <b className="gm-col-n"><CountUp to={l.count} /></b>
            <span className="gm-col-bar"><i style={{ height: ready ? `${Math.max(l.count ? 6 : 2, (l.count / max) * 100)}%` : "0%", transitionDelay: `${i * 70}ms` }} /></span>
            <small>L{l.level}</small><small className="gm-col-name">{l.name}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tiers({ t }: { t: { bronze: number; silver: number; gold: number } }) {
  const ready = useReady(), total = t.bronze + t.silver + t.gold;
  const seg = [["gold", t.gold, "var(--t3)"], ["silver", t.silver, "var(--t2)"], ["bronze", t.bronze, "var(--t1)"]] as const;
  let acc = 0;
  return (
    <div className="card gm-card">
      <h3>Badge tiers</h3><p className="muted small">Every badge earned in the school, by tier.</p>
      <div className="gm-donut-wrap">
        <svg className="gm-donut" viewBox="0 0 36 36" role="img" aria-label={`Gold ${t.gold}, silver ${t.silver}, bronze ${t.bronze}`}>
          <circle cx="18" cy="18" r="14" pathLength={100} className="gm-donut-track" />
          {total > 0 && seg.map(([k, n, col]) => { const len = (n / total) * 100, off = acc; acc += len; return <circle key={k} cx="18" cy="18" r="14" pathLength={100} stroke={col} strokeDasharray={`${ready ? Math.max(0, len - 0.8) : 0} 100`} strokeDashoffset={-off} className="gm-donut-seg" />; })}
        </svg>
        <div className="gm-donut-mid"><b><CountUp to={total} /></b><small>badges</small></div>
      </div>
      <div className="gm-legend">{seg.map(([k, n, col]) => <span key={k}><i style={{ background: col }} />{TIER_MARK[k]} {k} <b>{n}</b></span>)}</div>
    </div>
  );
}

function Pulse({ days, title = "XP given each day" }: { days: { day: string; xp: number }[]; title?: string }) {
  const [hov, setHov] = useState<number | null>(null);
  const W = 560, H = 150, P = 14, max = Math.max(10, ...days.map((d) => d.xp));
  const pts = useMemo(() => days.map((d, i) => [P + (i / Math.max(1, days.length - 1)) * (W - 2 * P), H - P - (d.xp / max) * (H - 2 * P)]), [days, max]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]} ${H - P} L${pts[0][0]} ${H - P} Z`, total = days.reduce((a, d) => a + d.xp, 0);
  const h = hov === null ? null : days[hov];
  return (
    <div className="gm-pulse">
      <div className="row"><b className="grow">{title}</b><span className="muted small" aria-live="polite">{h ? `${new Date(h.day + "T00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${h.xp} XP` : `${total} XP in 14 days`}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, last 14 days, ${total} XP in total`} onPointerLeave={() => setHov(null)}>
        <defs><linearGradient id="gmArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity=".38" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#gmArea)" className="gm-area" />
        <path d={line} className="gm-line" pathLength={1} />
        {pts.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r={hov === i ? 6 : 3.2} className="gm-dot" style={{ animationDelay: `${0.6 + i * 0.04}s` }} /><rect x={x - (W / days.length) / 2} y={0} width={W / days.length} height={H} fill="transparent" onPointerEnter={() => setHov(i)} onPointerDown={() => setHov(i)} /></g>)}
      </svg>
    </div>
  );
}

function Badges({ rows }: { rows: any[] }) {
  const ready = useReady(), max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section aria-label="Badges earned across the school">
      <h2 className="gm-h">Badge wall</h2>
      <div className="gm-wall">
        {rows.map((b, i) => (
          <div key={b.code} className="gm-tile" style={{ animationDelay: `${i * 50}ms` }} title={`${b.name}: ${b.total}`}>
            <span className="gm-tile-ic" aria-hidden>{BADGE_EMOJI[b.code] || "🏅"}</span>
            <b className="gm-tile-n"><CountUp to={b.total} /></b>
            <small className="gm-tile-name">{b.name}</small>
            <span className="gm-stack" style={{ width: `${ready ? Math.max(b.total ? 10 : 0, (b.total / max) * 100) : 0}%` }} role="img" aria-label={`Gold ${b.gold}, silver ${b.silver}, bronze ${b.bronze}`}>
              <i style={{ flexGrow: b.gold, background: "var(--t3)" }} /><i style={{ flexGrow: b.silver, background: "var(--t2)" }} /><i style={{ flexGrow: b.bronze, background: "var(--t1)" }} />
            </span>
            <small className="muted">🥇{b.gold} · 🥈{b.silver} · 🥉{b.bronze}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- one student */
function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useLoad(() => api<any>(`/gamification/admin/students/${id}/`), [id]);
  const x = d.data;
  return (
    <Modal label="Student gamification" onClose={onClose}>
      {d.loading && !x ? <div className="gm-skel" role="status" aria-label="Loading"><i /><i /><i /></div> : d.error || !x ? <ErrorNote error={d.error || "Not found"} retry={d.reload} /> : (
        <div className="gm-detail">
          <div className="gm-d-head">
            <span className="gm-d-ring" style={{ ["--p" as any]: x.level.progress_percent }}><Face name={x.name} photo={x.photo} size={84} /></span>
            <div className="grow"><h2>{x.name}</h2><p className="muted">{x.class || "No class"} · {x.index || x.username}</p>
              <p><span className="pill">Level {x.level.level} · {x.level.name}</span></p></div>
          </div>
          <div className="gm-d-stats">
            <div><b><CountUp to={x.xp} /></b><small>XP</small></div>
            <div><b>#{x.rank}</b><small>of {x.of} in school</small></div>
            <div><b>{x.class_rank ? `#${x.class_rank}` : "–"}</b><small>{x.class_size ? `of ${x.class_size} in class` : "in class"}</small></div>
            <div><b>🔥 {x.streak.current}</b><small>best {x.streak.best} days</small></div>
          </div>
          {x.level.next_name ? <div><div className="row small"><span className="grow">Next: <b>{x.level.next_name}</b></span><span>{x.level.xp_to_next} XP to go</span></div><Bar value={x.level.progress_percent} label="Progress to the next level" /></div> : <p className="ok">Top level reached 🎉</p>}
          <Pulse days={x.daily_xp} title="XP, last 14 days" />
          <h3>Badges <small className="muted">{x.badge_total} of {x.badge_catalog_total}</small></h3>
          {x.badges_earned.length ? <div className="gm-bchips">{x.badges_earned.map((b: any, i: number) => <span key={b.code + (b.subject || "")} className={`gm-bchip t-${b.tier}`} style={{ animationDelay: `${i * 45}ms` }}><span aria-hidden>{BADGE_EMOJI[b.code] || "🏅"}</span>{b.name}{b.subject ? ` · ${b.subject}` : ""} <small>{TIER_MARK[b.tier]} {b.tier_label}</small></span>)}</div> : <p className="muted">No badges yet.</p>}
          {x.next_goals.length > 0 && <><h3>Closest to earning</h3>{x.next_goals.map((g: any) => <div key={g.code + (g.subject || "")} className="gm-goal"><div className="row small"><span className="grow">{BADGE_EMOJI[g.code]} {g.name}{g.subject ? ` · ${g.subject}` : ""}</span><span>{g.progress}/{g.target} {g.unit}</span></div><Bar value={(g.progress / g.target) * 100} label={g.name} /></div>)}</>}
          <div className="gm-d-two">
            <div><h3>Where the XP came from</h3>
              {x.xp_by_kind.length ? <><div className="gm-mix">{x.xp_by_kind.map((k: any, i: number) => <i key={k.kind} title={`${k.kind}: ${k.points}`} style={{ flexGrow: Math.max(1, k.points), background: `color-mix(in srgb, var(--primary) ${100 - i * 14}%, var(--soft))` }} />)}</div>
                <div className="gm-legend">{x.xp_by_kind.map((k: any, i: number) => <span key={k.kind}><i style={{ background: `color-mix(in srgb, var(--primary) ${100 - i * 14}%, var(--soft))` }} />{k.kind} <b>{k.points}</b></span>)}</div></> : <p className="muted">Nothing yet.</p>}</div>
            <div><h3>Activity</h3><p className="small">Active on <b>{x.active_days_last_30}</b> of the last 30 days.<br />Exam streak: <b>{x.exam_streak.current}</b> (best {x.exam_streak.best}).<br />Practice quizzes: <b>{x.practice_sessions}</b>{x.practice_average_percent !== null ? `, average ${x.practice_average_percent}%` : ""}.{x.hidden_from_leaderboard && <><br /><span className="muted">Hidden from the class leaderboard by her own choice.</span></>}</p></div>
          </div>
          {x.recent.length > 0 && <details className="gm-recent"><summary>Latest XP</summary>{x.recent.map((r: any, i: number) => <p key={i} className="small row"><span className="grow">{r.label}</span><b>+{r.points}</b><span className="muted">{eatDate(r.at, { day: "numeric", month: "short" }, "en")}</span></p>)}</details>}
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------- search */
function Finder({ open }: { open: (id: number) => void }) {
  const [q, setQ] = useState(""), [rows, setRows] = useState<any[] | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const seq = useRef(0), box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRows(null); setErr(""); setBusy(false); return; }
    const me = ++seq.current; setBusy(true);
    const h = setTimeout(() => api<any>(`/gamification/admin/students/?q=${encodeURIComponent(t)}`).then((r) => { if (me === seq.current) { setRows(r.results); setErr(""); } }).catch((e) => { if (me === seq.current) setErr(e.message); }).finally(() => { if (me === seq.current) setBusy(false); }), 280);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {  // "/" jumps to the search
    const h = (e: KeyboardEvent) => { const el = document.activeElement as HTMLElement | null; if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(el?.tagName || "")) { e.preventDefault(); box.current?.focus(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <section className="gm-find" aria-label="Find a student">
      <h2 className="gm-h">Find any student</h2>
      <label className={`gm-search ${busy ? "busy" : ""}`}>
        <span className="gm-search-ic" aria-hidden>🔍</span>
        <input ref={box} className="input" type="search" placeholder="Type a name, user name or index number   ( / )" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rows?.[0] && open(rows[0].id)} aria-label="Search students" />
        <i className="gm-search-bar" aria-hidden />
      </label>
      {err && <p className="no" role="alert">⚠ {err}</p>}
      {rows !== null && !rows.length && !busy && <p className="muted gm-none" role="status">No student matches “{q.trim()}”.</p>}
      {rows && rows.length > 0 && (
        <div className="gm-hits" role="list">
          {rows.map((s, i) => (
            <button key={s.id} role="listitem" type="button" className="gm-hit" style={{ animationDelay: `${i * 45}ms` }} onClick={() => open(s.id)}>
              <Face name={s.name} photo={s.photo} size={44} />
              <span className="gm-hit-t"><b>{s.name}</b><small className="muted">{s.class || "No class"} · {s.index || s.username}</small></span>
              <span className="gm-hit-n"><b>{s.xp}</b><small>XP</small></span>
              <span className="gm-hit-n"><b>L{s.level}</b><small>{s.level_name}</small></span>
              <span className="gm-hit-n"><b>🏅{s.badges}</b><small>badges</small></span>
            </button>
          ))}
        </div>
      )}
      {rows === null && <p className="muted small gm-tip">Search finds up to 8 students at a time. Tap one to see her level, badges, streak and rank.</p>}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- page */
export default function GamificationPage() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const ov = useLoad(() => (admin ? api<any>("/gamification/admin/overview/") : Promise.resolve(null)), [admin]);
  const [open, setOpen] = useState<number | null>(null);
  const o = ov.data;
  return (
    <Shell title="Gamification">
      <div className="gm">
        {!admin ? <p>Only administrators can see this page.</p> : ov.error ? <ErrorNote error={ov.error} retry={ov.reload} /> : !o ? <div className="gm-skel" role="status" aria-label="Loading"><i /><i /><i /></div> : (
          <>
            <header className="gm-hero">
              <i className="gm-orb a" aria-hidden /><i className="gm-orb b" aria-hidden />
              <div><h1>Gamification</h1><p>XP, levels and badges across the school. Numbers only, no exam marks.</p></div>
              <ul className="gm-kpis" aria-label="School totals">
                <li><b><CountUp to={o.students} /></b><small>students</small></li>
                <li><b><CountUp to={o.total_xp} ms={1400} /></b><small>XP earned</small></li>
                <li><b><CountUp to={o.total_badges} /></b><small>badges earned</small></li>
                <li><b><CountUp to={o.active_last_7_days} /></b><small>active this week</small></li>
              </ul>
            </header>
            <Podium top={o.top} open={setOpen} />
            <div className="gm-two"><Levels levels={o.levels} /><Tiers t={o.tier_totals} /></div>
            <div className="card gm-card"><Pulse days={o.daily_xp} title="XP given each day, whole school" /></div>
            <Badges rows={o.badges} />
            <Finder open={setOpen} />
          </>
        )}
      </div>
      {open !== null && <Detail id={open} onClose={() => setOpen(null)} />}
    </Shell>
  );
}
