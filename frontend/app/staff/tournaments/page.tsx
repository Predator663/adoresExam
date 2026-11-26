"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import { useSession } from "@/lib/session";
import "./tournaments.css";

type P = { id: number; name: string; class: string; form: number | null; role: string; state: string; correct: number | null; total: number | null; time_ms: number | null; xp: number | null; penalty: number; win_pct: number; outcome: string };
type Row = { id: number; subject: string; status: string; outcome: string; how: string; questions: number; seconds: number; created_at: string; expires_at: string; finished_at: string | null; players: P[]; winner: string; upset: boolean; gap: number };

const STATUS: Record<string, string> = { open: "Waiting", finished: "Finished", expired: "No contest", declined: "Declined", cancelled: "Cancelled" };
const secs = (ms: number | null) => (ms == null ? "–" : `${Math.round(ms / 1000)}s`);
const STATE: Record<string, string> = { finished: "Played", playing: "Playing now", not_started: "Not started" };

function Player({ p, row }: { p: P; row: Row }) {
  const won = p.outcome === "won", done = row.status === "finished";
  return (
    <div className={`at-p${won ? " win" : ""}${p.outcome === "lost" ? " lose" : ""}`}>
      <span className="at-name">{won && <span aria-hidden>🏆 </span>}<b>{p.name}</b></span>
      <span className="muted small">{p.class || "—"} · {p.role === "challenger" ? "challenged" : "was challenged"}</span>
      {done ? (
        <span className="at-score">{p.correct ?? 0}/{p.total ?? row.questions} <small>· {secs(p.time_ms)}</small></span>
      ) : <span className="muted small">{STATE[p.state] || p.state}</span>}
      {done && <span className="at-chips">
        <i className={`at-res ${p.outcome}`}>{p.outcome === "won" ? "Won" : p.outcome === "lost" ? "Lost" : p.outcome === "draw" ? "Draw" : "No result"}</i>
        {p.xp != null && <i className={p.xp < 0 ? "at-neg" : "at-pos"}>{p.xp > 0 ? "+" : ""}{p.xp} XP</i>}
        {p.penalty > 0 && <i className="at-neg">penalty −{p.penalty}</i>}
        {won && p.win_pct !== 100 && <i className={p.win_pct > 100 ? "at-pos" : "at-neg"}>win pays {p.win_pct}%</i>}
      </span>}
    </div>
  );
}

function Match({ r }: { r: Row }) {
  return (
    <article className={`card at-match s-${r.status}`}>
      <header>
        <span><b>#{r.id}</b> · {r.subject} · {r.questions} questions · {r.seconds}s each</span>
        <span className="at-tags">
          {r.upset && <i className="at-up">Upset</i>}
          {r.gap > 0 && <i className="at-gap">{r.gap} class{r.gap > 1 ? "es" : ""} apart</i>}
          {r.outcome === "win" && r.how === "time" && <i className="at-gap">won on time</i>}
          <i className={`at-st st-${r.status}`}>{STATUS[r.status] || r.status}</i>
        </span>
      </header>
      <div className="at-vs"><Player p={r.players[0]} row={r} /><span className="at-v" aria-hidden>VS</span><Player p={r.players[1]} row={r} /></div>
      <footer className="muted small">Declared {eatDate(r.created_at)}{r.status === "open" ? ` · closes ${eatDate(r.expires_at)}` : r.finished_at ? ` · settled ${eatDate(r.finished_at)}` : ""}</footer>
    </article>
  );
}

export default function AdminTournaments() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [status, setStatus] = useState(""), [form, setForm] = useState(""), [days, setDays] = useState(""), [q, setQ] = useState(""), [qq, setQq] = useState(""), [page, setPage] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setQq(q.trim().length >= 2 ? q.trim() : ""); setPage(1); }, 300); return () => clearTimeout(h); }, [q]);
  const d = useLoad(() => {
    if (!admin) return Promise.resolve(null);
    const p = new URLSearchParams({ page: String(page) });
    if (status) p.set("status", status); if (form) p.set("form", form); if (days) p.set("days", days); if (qq) p.set("q", qq);
    return api<any>(`/gamification/admin/tournaments/?${p}`);
  }, [admin, status, form, days, qq, page]);
  const set = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { fn(e.target.value); setPage(1); };
  const s = d.data?.summary;
  return (
    <Shell bare title="Tournaments">
      <StaffNav />
      {!admin ? <p>Only administrators can see tournaments.</p> : (
        <>
          <div className="card at-filters">
            <label className="field"><span>Find a student</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name (2+ letters)" /></label>
            <label className="field"><span>Status</span><select className="input" value={status} onChange={set(setStatus)}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>Class level</span><select className="input" value={form} onChange={set(setForm)}><option value="">All</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Form {n}</option>)}</select></label>
            <label className="field"><span>Period</span><select className="input" value={days} onChange={set(setDays)}><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
          </div>
          {d.loading && !d.data ? <Loading /> : d.error || !d.data ? <ErrorNote error={d.error} retry={d.reload} /> : (
            <>
              <div className="at-stats">
                <div className="stat"><b>{s.total}</b>Tournaments</div><div className="stat"><b>{s.finished}</b>Finished</div><div className="stat"><b>{s.open}</b>Waiting</div>
                <div className="stat"><b>{s.expired}</b>No contest</div><div className="stat"><b>{s.declined + s.cancelled}</b>Declined / cancelled</div><div className="stat"><b>{s.players}</b>Students who played</div>
                <div className="stat"><b>{s.cross_class}</b>Across classes</div><div className="stat"><b>{s.upsets}</b>Upsets (lower class won)</div><div className="stat"><b>{s.xp_paid}</b>XP paid · {s.xp_taken} taken</div>
              </div>
              {d.data.top.length > 0 && (
                <div className="card"><h3 style={{ marginTop: 0 }}>Best players</h3>
                  <div className="tbl-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Class</th><th>Played</th><th>Won</th><th>Drawn</th><th>Lost</th><th>XP</th></tr></thead><tbody>
                    {d.data.top.map((t: any, i: number) => <tr key={t.id}><td>{i + 1}</td><td>{t.name}</td><td>{t.class || "—"}</td><td>{t.played}</td><td><b>{t.won}</b></td><td>{t.drawn}</td><td>{t.lost}</td><td>{t.xp}</td></tr>)}
                  </tbody></table></div></div>
              )}
              {d.data.results.length === 0 ? <div className="card"><p className="muted">No tournaments match these filters.</p></div> : (
                <div className="at-list">{d.data.results.map((r: Row) => <Match key={r.id} r={r} />)}</div>
              )}
              {d.data.pages > 1 && (
                <div className="row" style={{ justifyContent: "center", gap: ".6rem" }}>
                  <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
                  <span className="muted">Page {d.data.page} of {d.data.pages}</span>
                  <button className="btn" disabled={page >= d.data.pages} onClick={() => setPage(page + 1)}>Older →</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
