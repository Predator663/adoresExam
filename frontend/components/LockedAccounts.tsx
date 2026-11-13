"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { Pager, usePaged } from "./Pager";
import { CountUp, ErrorNote, Loading, Modal, Tabs, useLoad, useNow } from "./ui";
import { api } from "@/lib/api";
import { ago, clock, eatDate, makeOffset } from "@/lib/clock";
import { classLabel, errorLines } from "@/lib/staff";

/** Super Admin: every locked account (students, teachers, admins), live. Clear the wrong-attempt counter (the lock goes with it), or give a new starting
 *  password. Backend: accounts/lockouts.py. The list refreshes itself every 15 seconds and counts each lock down to its automatic end. */

type Row = {
  id: number; username: string; first_name: string; last_name: string; index_number: string; class_name: string | null;
  is_active: boolean; locked: boolean; locked_until: string | null; seconds_left: number; failed_logins: number; attempts_left: number;
  last_login: string | null; must_change_password: boolean; role: "student" | "teacher" | "admin";
};
type RoleKey = "student" | "teacher" | "admin";
const ROLE_TABS: [RoleKey, string][] = [["student", "Students"], ["teacher", "Teachers"], ["admin", "Admins"]];
type Cred = { id: number; name: string; username: string; class_name: string; temporary_password: string };
type Ask = { kind: "unlock" | "password"; ids: number[]; label: string };
type Shown = { title: string; creds: Cred[] };

const calm = () => typeof document !== "undefined" && (document.documentElement.classList.contains("reduce-motion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const fullName = (r: { first_name: string; last_name: string; username: string }) => `${r.first_name} ${r.last_name}`.trim() || r.username;
const initials = (r: Row) => ((r.first_name[0] || "") + (r.last_name[0] || "") || r.username.slice(0, 2)).toUpperCase();
const hhmm = (iso: string) => eatDate(iso, { hour: "2-digit", minute: "2-digit" });

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* old browser or plain http: fall back below */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy"); t.remove(); return ok;
  } catch { return false; }
}
/** A cell that starts with = + - @ would run as a formula in Excel; a leading apostrophe stops that. */
const csvCell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
function downloadCsv(creds: Cred[]) {
  const lines = [["Class", "Name", "Username", "Password"].map(csvCell).join(",")]
    .concat(creds.map((c) => [c.class_name, c.name, c.username, c.temporary_password].map(csvCell).join(",")));
  const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "new-starting-passwords.csv"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1800); return () => clearTimeout(t); }, [done]);
  return <button type="button" className={`btn ${done ? "lk-copied" : ""}`} onClick={async () => setDone(await copyText(text))}><Icon n={done ? "check" : "file"} size={16} />{done ? "Copied" : label}</button>;
}

/** The wrong-try meter: one dot per allowed try. Filled = used. A locked account has them all lit. */
function Pips({ used, max, locked }: { used: number; max: number; locked: boolean }) {
  return (
    <span className={`lk-pips ${locked ? "is-locked" : ""}`} role="img" aria-label={locked ? `All ${max} tries used` : `${used} of ${max} tries used`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={locked || i < used ? "on" : ""} style={{ ["--d" as any]: `${i * 70}ms` }} />)}
    </span>
  );
}

function LockRow({ r, i, now, offset, total, max, sel, busy, gone, onSel, onUnlock, onPassword }: {
  r: Row; i: number; now: number; offset: number; total: number; max: number; sel: boolean; busy: boolean; gone: boolean;
  onSel: (on: boolean) => void; onUnlock: () => void; onPassword: () => void;
}) {
  const left = r.locked && r.locked_until ? new Date(r.locked_until).getTime() - (now + offset) : 0;
  const open = r.locked && left > 0;  // the lock ended by itself while the page was open
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  return (
    <li className={`lk-row ${open ? "is-locked" : "is-warn"} ${sel ? "is-sel" : ""} ${gone ? "lk-out" : ""}`} style={{ ["--i" as any]: Math.min(i, 12) }}>
      <label className="lk-check"><input type="checkbox" checked={sel} disabled={busy} onChange={(e) => onSel(e.target.checked)} aria-label={`Select ${fullName(r)}`} /></label>
      <span className="lk-av" aria-hidden>{initials(r)}<Icon n={open ? "lock" : "unlock"} size={13} /></span>
      <div className="lk-main">
        <div className="lk-name"><b>{fullName(r)}</b>{!r.is_active && <span className="pill">deactivated</span>}</div>
        <div className="muted small lk-meta">@{r.username}{r.role !== "student" ? ` · ${r.role === "teacher" ? "Teacher" : "Admin"}` : ""}{r.class_name ? ` · ${r.class_name}` : ""}{r.index_number ? ` · ${r.index_number}` : ""}</div>
        <div className="lk-state">
          <Pips used={r.failed_logins} max={max} locked={open} />
          {open ? <span className="lk-count" role="timer" aria-label={`Unlocks in ${clock(left)}`}><Icon n="clock" size={14} />{clock(left)}<span className="muted small"> · opens by itself at {hhmm(r.locked_until!)}</span></span>
            : r.locked ? <span className="lk-count ok">Opening now…</span>
            : <span className="muted small">{r.failed_logins} of {max} wrong tries used · {r.attempts_left} left</span>}
        </div>
        {open && <div className="lk-drain" aria-hidden><i style={{ transform: `scaleX(${pct / 100})` }} /></div>}
        <div className="muted small">{r.last_login ? `Last signed in ${ago(r.last_login)}` : "Has never signed in"}{r.must_change_password ? " · must choose a new password" : ""}</div>
      </div>
      <div className="lk-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={onUnlock} aria-label={`${open ? "Unlock" : "Reset tries for"} ${fullName(r)}`}><Icon n="unlock" size={16} />{open ? "Unlock" : "Reset tries"}</button>
        <button type="button" className="btn" disabled={busy} onClick={onPassword} aria-label={`New password for ${fullName(r)}`}><Icon n="key" size={16} />New password</button>
      </div>
    </li>
  );
}

export default function LockedAccounts() {
  const [role, setRole] = useState<RoleKey>("student"), [tab, setTab] = useState("locked"), [qBox, setQBox] = useState(""), [q, setQ] = useState(""), [cls, setCls] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(qBox.trim()), 300); return () => clearTimeout(t); }, [qBox]);
  const classes = useLoad(() => api<any[]>("/classes/"));
  const list = usePaged<Row>("/lockouts/", { role, status: tab, q, class: role === "student" ? cls : "" }, { size: 20 });
  const now = useNow(1000);
  const sum = list.data?.summary as { locked: number; warning: number; max_attempts: number; lock_minutes: number; roles: Record<RoleKey, { locked: number; warning: number }> } | undefined;
  const everyone = sum ? Object.values(sum.roles).reduce((a, r) => ({ locked: a.locked + r.locked, warning: a.warning + r.warning }), { locked: 0, warning: 0 }) : { locked: 0, warning: 0 };
  const offset = useMemo(() => (list.data?.server_time ? makeOffset(list.data.server_time) : 0), [list.data?.server_time]);  // how far this device's clock is from the server's
  const total = (sum?.lock_minutes || 15) * 60_000;

  const [sel, setSel] = useState<number[]>([]), [busy, setBusy] = useState<number[]>([]), [gone, setGone] = useState<number[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null), [shown, setShown] = useState<Shown | null>(null);
  const [errs, setErrs] = useState<string[]>([]), [note, setNote] = useState(""), [working, setWorking] = useState(false);
  const [stamp, setStamp] = useState<number>(Date.now());

  // when new data arrives: remember the time, forget rows that were animating out
  useEffect(() => { if (list.data) { setStamp(Date.now()); setGone([]); } }, [list.data]);
  // keep fresh by itself, but only while the screen is being looked at
  const reload = useRef(list.reload);
  reload.current = list.reload;  // the timer below must not restart on every clock tick
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible" && !ask && !working) reload.current(); }, 15_000);
    return () => clearInterval(i);
  }, [ask, working]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 7000); return () => clearTimeout(t); }, [note]);
  // a lock that ran out while the page was open: ask the server once, so the list drops her
  const asked = useRef<Set<number>>(new Set());
  useEffect(() => {
    const ended = list.rows.filter((r) => r.locked && r.locked_until && new Date(r.locked_until).getTime() <= now + offset && !asked.current.has(r.id));
    if (ended.length) { ended.forEach((r) => asked.current.add(r.id)); setTimeout(() => list.reload(), 1200); }
  }, [now, offset, list.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = list.rows;
  const allOnPage = rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const byId = useCallback((id: number) => rows.find((r) => r.id === id), [rows]);

  const finish = (ids: number[], message: string) => {
    setNote(message); setSel((s) => s.filter((x) => !ids.includes(x)));
    if (calm()) { list.reload(); return; }
    setGone(ids); setTimeout(() => list.reload(), 520);  // let the row slide away first
  };
  async function doUnlock(ids: number[]) {
    setErrs([]); setWorking(true); setBusy((b) => [...b, ...ids]);
    try {
      if (ids.length === 1) {
        const r = await api<any>(`/lockouts/${ids[0]}/reset-attempts/`, { body: {} });
        const who = byId(ids[0]); const name = who ? fullName(who) : "The account";
        finish(ids, r.was_locked ? `${name} is unlocked and can sign in now.` : r.changed ? `${name}'s wrong tries were reset.` : `${name} had nothing to reset.`);
      } else {
        const r = await api<any>("/lockouts/bulk/", { body: { ids, action: "reset_attempts", role } });
        finish(ids, `${r.affected} account${r.affected === 1 ? "" : "s"} unlocked${r.skipped ? ` (${r.skipped} skipped)` : ""}.`);
      }
    } catch (e: any) { setErrs(errorLines(e.data, e.message)); list.reload(); }
    setBusy((b) => b.filter((x) => !ids.includes(x))); setWorking(false);
  }
  async function doPassword(ids: number[]) {
    setErrs([]); setWorking(true); setBusy((b) => [...b, ...ids]);
    try {
      let creds: Cred[];
      if (ids.length === 1) {
        const r = await api<any>(`/lockouts/${ids[0]}/reset-password/`, { body: {} });
        const s = r.student;
        creds = [{ id: s.id, name: fullName(s), username: s.username, class_name: s.class_name || "", temporary_password: r.temporary_password }];
      } else {
        creds = (await api<any>("/lockouts/bulk/", { body: { ids, action: "reset_passwords", role } })).credentials;
      }
      setShown({ title: creds.length === 1 ? (role === "student" ? "New starting password" : "New password") : `${creds.length} new starting passwords`, creds });
      finish(ids, creds.length === 1 ? `${creds[0].name} has a new password and is unlocked.` : `${creds.length} accounts have new passwords and are unlocked.`);
    } catch (e: any) { setErrs(errorLines(e.data, e.message)); list.reload(); }
    setBusy((b) => b.filter((x) => !ids.includes(x))); setWorking(false);
  }
  const proceed = async () => { const a = ask; if (!a) return; setAsk(null); await (a.kind === "unlock" ? doUnlock(a.ids) : doPassword(a.ids)); };

  const tabs = [["locked", `Locked now${sum ? ` (${sum.locked})` : ""}`], ["warning", `Tries used${sum ? ` (${sum.warning})` : ""}`], ["all", "All affected"]];
  const filtered = !!(q || cls);
  const lockedNow = everyone.locked;

  return (
    <div className="lk">
      <section className={`lk-hero ${lockedNow ? "alert" : "calm"}`} aria-label="Summary">
        <span className="lk-badge" aria-hidden><i /><i /><Icon n={lockedNow ? "lock" : "shield"} size={30} /></span>
        <div className="lk-hero-txt">
          <h1>Locked accounts</h1>
          <p>{!sum ? "Checking…" : lockedNow ? `${lockedNow} account${lockedNow === 1 ? " is" : "s are"} locked out right now.` : "Nobody is locked out. Everyone can sign in."}</p>
          {sum && <p className="small lk-rule">An account is locked for {sum.lock_minutes} minutes after {sum.max_attempts} wrong passwords in a row. You can open it sooner.</p>}
        </div>
        <div className="lk-kpis">
          <div className="lk-kpi bad"><b><CountUp to={everyone.locked} /></b><span>Locked now</span></div>
          <div className="lk-kpi warn"><b><CountUp to={everyone.warning} /></b><span>Tries used</span></div>
        </div>
      </section>

      <Tabs tabs={ROLE_TABS.map(([k, l]) => [k, `${l}${sum?.roles[k].locked ? ` · ${sum.roles[k].locked} locked` : ""}`])} value={role} onChange={(r) => { setRole(r as RoleKey); setSel([]); setCls(""); }} />
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); }} />

      <div className="card lk-tools" role="search">
        <input className="input grow" type="search" placeholder={role === "student" ? "Search name, username or index number" : "Search name or username"} aria-label="Search accounts" autoComplete="off" value={qBox} onChange={(e) => setQBox(e.target.value)} />
        {role === "student" && <select className="input" aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select>}
        <button type="button" className="btn" onClick={() => list.reload()} aria-label="Refresh now"><span className={list.busy || list.loading ? "lk-spin" : ""}><Icon n="refresh" size={16} /></span>Refresh</button>
        <span className="lk-live small muted" aria-live="off"><i aria-hidden />Live · updated {ago(new Date(stamp).toISOString())}</span>
        {filtered && <button type="button" className="btn ghost" onClick={() => { setQBox(""); setQ(""); setCls(""); }}>Clear</button>}
      </div>

      {note && <p className="lk-toast" role="status"><Icon n="check" size={18} />{note}</p>}
      {errs.length > 0 && <div className="card error" role="alert">{errs.map((e, k) => <p key={k}>⚠ {e}</p>)}</div>}

      {list.loading ? <Loading /> : list.error && !list.data ? <ErrorNote error={list.error} retry={list.reload} /> : rows.length === 0 ? (
        <div className="card lk-empty">
          <span className="lk-ok" aria-hidden><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23" /><path d="M15 27l8 8 14-17" /></svg></span>
          <h3>{filtered ? "No one matches this search" : tab === "locked" ? `No locked ${ROLE_TABS.find((x) => x[0] === role)![1].toLowerCase()}` : tab === "warning" ? "No one has used up tries" : "All clear"}</h3>
          <p className="muted">{filtered ? "Try fewer words, another class, or press Clear." : "This page checks again by itself every few seconds."}</p>
        </div>
      ) : (
        <>
          <div className="lk-listhead">
            <label className="lk-all"><input type="checkbox" checked={allOnPage} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...rows.map((r) => r.id)])] : sel.filter((id) => !rows.some((r) => r.id === id)))} /> Select all on this page</label>
            <span className="muted small" aria-live="polite">{list.count} account{list.count === 1 ? "" : "s"}{filtered ? " found" : ""}</span>
          </div>
          <ul className="lk-list paged" ref={list.top} aria-busy={list.busy || undefined}>
            {rows.map((r, i) => (
              <LockRow key={r.id} r={r} i={i} now={now} offset={offset} total={total} max={sum?.max_attempts || 5} sel={sel.includes(r.id)} busy={busy.includes(r.id)} gone={gone.includes(r.id)}
                onSel={(on) => setSel(on ? [...sel, r.id] : sel.filter((x) => x !== r.id))}
                onUnlock={() => doUnlock([r.id])} onPassword={() => setAsk({ kind: "password", ids: [r.id], label: fullName(r) })} />
            ))}
          </ul>
          <Pager {...list.pager} />
        </>
      )}

      {sel.length > 0 && (
        <div className="lk-bulk" role="region" aria-label="Actions for the selected accounts">
          <b>{sel.length} selected</b>
          <button type="button" className="btn primary" disabled={working} onClick={() => setAsk({ kind: "unlock", ids: sel, label: `${sel.length} accounts` })}><Icon n="unlock" size={16} />Unlock</button>
          {role === "student" ? <button type="button" className="btn" disabled={working} onClick={() => setAsk({ kind: "password", ids: sel, label: `${sel.length} students` })}><Icon n="key" size={16} />New passwords</button>
            : <span className="muted small">New passwords for staff are given one at a time.</span>}
          <button type="button" className="btn ghost" onClick={() => setSel([])}>Clear</button>
        </div>
      )}

      {ask && (
        <Modal label={ask.kind === "unlock" ? "Unlock accounts" : "New passwords"} onClose={() => setAsk(null)}>
          <h2>{ask.kind === "unlock" ? `Unlock ${ask.label}?` : `Give ${ask.label} a new password?`}</h2>
          <p>{ask.kind === "unlock"
            ? "Their wrong tries are set back to zero and any lock is removed. Their passwords stay as they are."
            : "Each account gets a new random password, is signed out everywhere, and the lock is removed. They must choose their own password at the next sign-in. The new passwords are shown once, on the next screen."}</p>
          <div className="row"><button type="button" className="btn primary" onClick={proceed}>{ask.kind === "unlock" ? "Unlock" : "Give new password"}</button><button type="button" className="btn" onClick={() => setAsk(null)}>Cancel</button></div>
        </Modal>
      )}

      {shown && (
        <Modal label={shown.title} onClose={() => setShown(null)}>
          <h2>{shown.title}</h2>
          <p className="muted small">Shown once. Give each person their code on paper or by phone. They will be asked to choose their own password when they sign in.</p>
          {shown.creds.length === 1 ? (
            <div className="lk-code-card">
              <div className="muted small">{shown.creds[0].name} · @{shown.creds[0].username}{shown.creds[0].class_name ? ` · ${shown.creds[0].class_name}` : ""}</div>
              <div className="lk-code" aria-label="Starting password">{shown.creds[0].temporary_password}</div>
              <CopyButton text={shown.creds[0].temporary_password} label="Copy password" />
            </div>
          ) : (
            <div className="tbl-wrap lk-codes"><table><thead><tr><th>Class</th><th>Name</th><th>Username</th><th>Password</th></tr></thead>
              <tbody>{shown.creds.map((c) => <tr key={c.id}><td>{c.class_name}</td><td>{c.name}</td><td>{c.username}</td><td><code className="lk-mono">{c.temporary_password}</code></td></tr>)}</tbody></table></div>
          )}
          <div className="row" style={{ marginTop: ".8rem" }}>
            {shown.creds.length > 1 && <><button type="button" className="btn" onClick={() => downloadCsv(shown.creds)}><Icon n="download" size={16} />Download CSV</button>
              <CopyButton label="Copy all" text={shown.creds.map((c) => `${c.name}\t${c.username}\t${c.temporary_password}`).join("\n")} /></>}
            <button type="button" className="btn primary" onClick={() => setShown(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
