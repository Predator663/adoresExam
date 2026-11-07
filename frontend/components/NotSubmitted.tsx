"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountUp, ErrorNote, Loading, Modal, useLoad } from "@/components/ui";
import { useToast } from "@/components/SubmitFlow";
import { API, ApiError, api, friendly, getToken, schoolHost, words } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { eatDate } from "@/lib/clock";

/** Admin: who has NOT submitted an exam. Search, filter by class and status, sort, print, PDF and Excel.
 *  Tick students (or "select everyone listed") and allow them to sit: it works for a student who missed the exam completely, one whose time ran out,
 *  and one who is still writing (a second sitting after she finishes). Backend: POST /exams/<id>/grant-retakes/ and /revoke-retakes/.
 *  While the exam is still running the list refreshes by itself, so names drop off as students submit. */

type ExamOpt = { id: number; title: string; subject: string; status: string; start_at: string; end_at: string | null; classes: string[] };
type Opts = { exams: ExamOpt[]; classes: { id: number; label: string }[] };
type Parent = { name: string; phone: string; relationship: string };
type Row = { id: number; name: string; index: string; class: string; status: "none" | "writing" | "auto"; status_label: string; started_at: string | null; retake_allowed: boolean; parents: Parent[] };
type Data = {
  exam: { id: number; title: string; subject: string; status: string; start_at: string; end_at: string | null };
  summary: { eligible: number; submitted: number; not_submitted: number; none: number; writing: number; auto: number; pct_submitted: number | null; listed: number; allowed: number };
  classes: { class: string; eligible: number; not_submitted: number }[];
  rows: Row[]; filters: { label: string; value: string }[]; generated: string;
};

const STATUS: [string, string][] = [["none", "Did not sit"], ["writing", "Still writing"], ["auto", "Time ran out (auto-submitted)"]];
const SORTS: [string, string][] = [["class", "Class"], ["name", "Name"], ["status", "Status"], ["index", "Index number"]];
const when = (iso: string | null) => (iso ? eatDate(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
const examLabel = (e: ExamOpt) => `${e.title} · ${e.subject} · ${eatDate(e.start_at, { day: "numeric", month: "short" })}${e.status === "live" ? " · LIVE" : ""}`;

export default function NotSubmitted() {
  const brand = useBrand();
  const opts = useLoad(() => api<Opts>("/exams/not-submitted/options/"));
  const [exam, setExam] = useState(""), [klass, setKlass] = useState(""), [qBox, setQBox] = useState(""), [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>(["none", "writing"]), [sort, setSort] = useState("class"), [dir, setDir] = useState<"asc" | "desc">("asc");
  const [parents, setParents] = useState(false);
  const [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [fileBusy, setFileBusy] = useState<string>("");
  const { toast, show } = useToast();
  const seq = useRef(0);
  const [sel, setSel] = useState<number[]>([]), [ask, setAsk] = useState<"grant" | "revoke" | null>(null), [reason, setReason] = useState(""), [sure, setSure] = useState(false), [working, setWorking] = useState(false), [askErr, setAskErr] = useState("");
  useEffect(() => { setSel([]); }, [exam]);
  useEffect(() => { if (data) setSel((cur) => cur.filter((id) => data.rows.some((r) => r.id === id))); }, [data]);  // a student who sat meanwhile leaves the selection

  useEffect(() => { if (!exam && opts.data?.exams.length) setExam(String(opts.data.exams[0].id)); }, [opts.data, exam]);
  useEffect(() => { const t = setTimeout(() => setQ(qBox.trim()), 300); return () => clearTimeout(t); }, [qBox]);

  const query = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ exam, status: status.join(","), sort, dir });
    if (klass) p.set("class", klass);
    if (q) p.set("q", q);
    if (parents) p.set("parents", "1");
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }, [exam, status, sort, dir, klass, q, parents]);

  const load = useCallback((quiet = false) => {
    if (!exam || !status.length) return;
    const mine = ++seq.current;
    if (!quiet) setBusy(true);
    api<Data>(`/exams/not-submitted/?${query()}`)
      .then((d) => { if (seq.current === mine) { setData(d); setErr(""); } })
      .catch((e) => { if (seq.current === mine) setErr(friendly(e)); })
      .finally(() => { if (seq.current === mine) setBusy(false); });
  }, [exam, status, query]);
  useEffect(() => { load(); }, [load]);

  // a running exam keeps itself up to date (only while this tab is open and visible)
  const live = data?.exam.status === "live";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 15000);
    return () => clearInterval(t);
  }, [live, load]);

  async function file(kind: "pdf" | "xlsx") {
    if (fileBusy) return;
    setFileBusy(kind);
    try {
      const res = await fetch(`${API}/api/exams/not-submitted/export/?${query({ file: kind })}`, { headers: { Authorization: `Token ${getToken()}`, "X-School": schoolHost() } })
        .catch(() => { throw new ApiError(words().network, 0, "network"); });
      if (!res.ok) {
        let msg = words().file;
        try { const j = await res.json(); if (typeof j?.detail === "string") msg = j.detail; } catch { /* plain message */ }
        throw new ApiError(msg, res.status);
      }
      const blob = await res.blob();
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
      const name = m ? decodeURIComponent(m[1]) : `not-submitted.${kind}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      show("ok", kind === "pdf" ? "PDF ready" : "Excel ready", name);
    } catch (e) { show("err", "Could not make the file", e instanceof ApiError ? e.message : friendly(e)); }
    finally { setFileBusy(""); }
  }

  const toggle = (k: string) => setStatus(status.includes(k) ? status.filter((x) => x !== k) : STATUS.map((s) => s[0]).filter((x) => x === k || status.includes(x)));
  const filtered = !!(klass || q || status.join() !== "none,writing");
  const clear = () => { setKlass(""); setQBox(""); setQ(""); setStatus(["none", "writing"]); };
  const s = data?.summary;
  const submittedPct = s?.pct_submitted ?? 0;
  const maxClass = useMemo(() => Math.max(1, ...(data?.classes || []).map((c) => c.not_submitted)), [data]);

  const picked = (data?.rows || []).filter((r) => sel.includes(r.id));
  const writingN = picked.filter((r) => r.status === "writing").length, allowedN = picked.filter((r) => r.retake_allowed).length;
  const allListed = !!data?.rows.length && data.rows.every((r) => sel.includes(r.id));
  const open = (kind: "grant" | "revoke") => { setReason(""); setSure(false); setAskErr(""); setAsk(kind); };
  async function submitAsk() {
    if (!ask || !data) return;
    setWorking(true); setAskErr("");
    try {
      if (ask === "grant") {
        const r = await api<{ granted: number; already_allowed: number; not_eligible: number }>(`/exams/${data.exam.id}/grant-retakes/`, { body: { student_ids: sel, reason: reason.trim() } });
        show("ok", `${r.granted} student${r.granted === 1 ? "" : "s"} allowed to sit`, [r.already_allowed ? `${r.already_allowed} already had permission.` : "", r.not_eligible ? `${r.not_eligible} are not on this exam.` : "", "They were told in the app."].filter(Boolean).join(" "));
      } else {
        const r = await api<{ revoked: number }>(`/exams/${data.exam.id}/revoke-retakes/`, { body: { student_ids: sel } });
        show("ok", `Permission taken back for ${r.revoked} student${r.revoked === 1 ? "" : "s"}`);
      }
      setAsk(null); setSel([]); load(true);
    } catch (e: any) { setAskErr(friendly(e)); }
    setWorking(false);
  }

  if (opts.loading) return <Loading />;
  if (opts.error || !opts.data) return <ErrorNote error={opts.error} retry={opts.reload} />;
  if (!opts.data.exams.length) return <div className="card"><p className="muted">No exam has started yet, so nobody can have missed one. This page fills in as soon as an exam begins.</p></div>;
  const o = opts.data;

  return (
    <div className="ns-page">
      <div className="card fx-card ns-controls no-print">
        <div className="row"><h3 className="grow" style={{ margin: 0 }}>Who has not submitted</h3>{live && <span className="pill ns-live"><i /> Live · updates every 15 s</span>}</div>
        <div className="rr-grid">
          <label className="field"><span>Exam</span>
            <select className="input" value={exam} onChange={(e) => setExam(e.target.value)}>{o.exams.map((e) => <option key={e.id} value={e.id}>{examLabel(e)}</option>)}</select></label>
          <label className="field"><span>Class</span>
            <select className="input" value={klass} onChange={(e) => setKlass(e.target.value)}><option value="">All classes of this exam</option>{o.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="field"><span>Search</span>
            <input className="input" type="search" placeholder="Name, username or index number" autoComplete="off" value={qBox} onChange={(e) => setQBox(e.target.value)} /></label>
          <div className="field"><span id="ns-sort-l">Sort by</span>
            <div className="row" style={{ gap: ".4rem" }}>
              <select className="input grow" aria-labelledby="ns-sort-l" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <button type="button" className={`btn rr-dir ${dir === "desc" ? "flip" : ""}`} onClick={() => setDir(dir === "asc" ? "desc" : "asc")} aria-label={`Order: ${dir === "asc" ? "A to Z" : "Z to A"}. Press to change.`} title={dir === "asc" ? "A to Z" : "Z to A"}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            </div></div>
        </div>
        <div className="field"><span id="ns-st-l">Show</span>
          <div className="chips" role="group" aria-labelledby="ns-st-l">
            {STATUS.map(([k, l]) => { const on = status.includes(k); return <button key={k} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggle(k)}>{on ? "✓ " : ""}{l}</button>; })}
            <button type="button" className={`chip ${parents ? "on" : ""}`} aria-pressed={parents} onClick={() => setParents(!parents)}>{parents ? "✓ " : ""}Include parent contacts</button>
            {filtered && <button type="button" className="chip" onClick={clear}>Reset filters</button>}
          </div>
          {parents && <small className="muted">Parent phone numbers are private. Showing them is recorded in the audit log.</small>}
          {!status.length && <small className="no" role="alert">Choose at least one status to show.</small>}
        </div>
      </div>

      {err && <div className="card error no-print" role="alert"><p>⚠ {err}</p></div>}
      {!data && !err && <div className="rr-skels no-print" aria-hidden><i /><i /><i /><i /></div>}

      {data && s && (
        <div className={busy ? "rr-dim" : ""} aria-busy={busy || undefined}>
          <div className="ns-print-head" aria-hidden>
            {brand.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={brand.logoUrl} alt="" />}
            <div><h1>{brand.school}</h1>{(brand.address || brand.phone || brand.email) && <p>{[brand.address, brand.phone, brand.email].filter(Boolean).join(" | ")}</p>}<h2>Students who have not submitted the exam</h2></div>
          </div>

          <div className="card ns-sum">
            <p className="muted small ns-meta"><b>{data.exam.title}</b> · {data.exam.subject} · {when(data.exam.start_at)}{data.exam.end_at ? ` to ${eatDate(data.exam.end_at, { hour: "2-digit", minute: "2-digit" })}` : ""}
              {data.filters.filter((f) => ["Class filter", "Search"].includes(f.label)).map((f) => ` · ${f.label}: ${f.value}`).join("")}</p>
            <div className="grid3 rr-kpis">
              <div className="stat"><b><CountUp to={s.eligible} /></b>Expected</div>
              <div className="stat"><b><CountUp to={s.submitted} /></b>Submitted</div>
              <div className="stat ns-bad"><b><CountUp to={s.not_submitted} /></b>Not submitted</div>
              <div className="stat"><b><CountUp to={s.none} /></b>Did not sit</div>
              <div className="stat"><b><CountUp to={s.writing} /></b>Still writing</div>
              <div className="stat"><b><CountUp to={s.auto} /></b>Time ran out</div>
              {s.allowed > 0 && <div className="stat ns-ok"><b><CountUp to={s.allowed} /></b>Allowed to sit</div>}
            </div>
            <div className="ns-meter" role="img" aria-label={`${submittedPct}% submitted`}><i style={{ width: `${submittedPct}%` }} /><span>{s.pct_submitted === null ? "–" : `${s.pct_submitted}%`} submitted</span></div>
          </div>

          {data.classes.length > 1 && (
            <div className="card ns-classes no-print"><h4 style={{ margin: "0 0 .5rem" }}>Not submitted, by class</h4>
              {data.classes.map((c) => (
                <button key={c.class} type="button" className={`ns-class ${klass && o.classes.find((x) => String(x.id) === klass)?.label === c.class ? "on" : ""}`}
                  onClick={() => { const id = o.classes.find((x) => x.label === c.class)?.id; setKlass(id && String(id) !== klass ? String(id) : ""); }}
                  aria-label={`${c.class}: ${c.not_submitted} of ${c.eligible} not submitted. Press to filter.`}>
                  <span className="ns-cl">{c.class}</span><span className="ns-ct"><i style={{ width: `${(c.not_submitted / maxClass) * 100}%` }} /></span><b>{c.not_submitted}<small className="muted">/{c.eligible}</small></b>
                </button>
              ))}
            </div>
          )}

          <div className="card">
            <div className="row no-print">
              <h4 className="grow" style={{ margin: 0 }} aria-live="polite">{s.listed} student{s.listed === 1 ? "" : "s"} listed</h4>
              {!!s.listed && <button className="btn" onClick={() => setSel(allListed ? [] : data.rows.map((r) => r.id))}>{allListed ? "Clear selection" : `Select all ${s.listed}`}</button>}
              <button className="btn" onClick={() => window.print()} disabled={!s.listed}>🖨 Print</button>
              <button className="btn" onClick={() => file("pdf")} disabled={!!fileBusy}>{fileBusy === "pdf" ? "Making PDF…" : "⬇ PDF"}</button>
              <button className="btn" onClick={() => file("xlsx")} disabled={!!fileBusy}>{fileBusy === "xlsx" ? "Making Excel…" : "⬇ Excel"}</button>
            </div>
            {sel.length > 0 && (
              <div className="ns-bulk no-print" role="region" aria-label="Actions for the selected students">
                <b>{sel.length} selected</b>
                <button type="button" className="btn primary" onClick={() => open("grant")}>Allow to sit</button>
                {allowedN > 0 && <button type="button" className="btn" onClick={() => open("revoke")}>Take back permission ({allowedN})</button>}
                <button type="button" className="btn ghost" onClick={() => setSel([])}>Clear</button>
              </div>
            )}
            {!s.listed ? (
              <p className="rr-empty">{s.not_submitted === 0 && !q && !klass ? "Everyone expected has submitted. 🎉" : "Nobody matches these filters."}</p>
            ) : (
              <div className="tbl-wrap ns-table"><table>
                <thead><tr><th className="no-print"><input type="checkbox" className="ns-check" checked={allListed} onChange={(e) => setSel(e.target.checked ? data.rows.map((r) => r.id) : [])} aria-label="Select everyone listed" /></th><th>#</th><th>Student</th><th>Index no.</th><th>Class</th><th>Status</th><th>Started</th>{parents && <th>Parent / guardian</th>}<th className="print-only">Remarks</th></tr></thead>
                <tbody>{data.rows.map((r, i) => (
                  <tr key={r.id} className={`rr-row ${sel.includes(r.id) ? "ns-sel" : ""}`} style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}>
                    <td className="no-print"><input type="checkbox" className="ns-check" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} aria-label={`Select ${r.name}`} /></td>
                    <td>{i + 1}</td><td><b>{r.name}</b></td><td>{r.index || "–"}</td><td>{r.class}</td>
                    <td><span className={`ns-pill ns-${r.status}`}>{r.status_label}</span>{r.retake_allowed && <span className="ns-pill ns-allowed">Allowed to sit</span>}</td><td>{r.started_at ? when(r.started_at) : "–"}</td>
                    {parents && <td>{r.parents.length ? r.parents.map((p, k) => <div key={k}>{p.name}{p.relationship ? ` (${p.relationship})` : ""}: <a href={`tel:${p.phone}`}>{p.phone}</a></div>) : "–"}</td>}
                    <td className="print-only" />
                  </tr>))}</tbody></table></div>
            )}
            <p className="muted small ns-foot">Did not sit: never opened the exam. Still writing: started and has not pressed Submit. Time ran out: the system submitted for her when time ended.</p>
            <p className="ns-printed print-only">Printed {eatDate(data.generated, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
      )}
      {ask && data && (
        <Modal label={ask === "grant" ? "Allow to sit" : "Take back permission"} onClose={() => !working && setAsk(null)}>
          {ask === "grant" ? (
            <>
              <h2>Allow {sel.length} student{sel.length === 1 ? "" : "s"} to sit this exam?</h2>
              <p>{data.exam.title}: each student can start it now, even though the exam time is over, and gets the full exam time. They are told in the app. A student can use this once.</p>
              <ul className="small">
                {picked.filter((r) => r.status === "none").length > 0 && <li>{picked.filter((r) => r.status === "none").length} did not sit: they start the exam for the first time.</li>}
                {picked.filter((r) => r.status === "auto").length > 0 && <li>{picked.filter((r) => r.status === "auto").length} ran out of time: they sit it again, and the new sitting counts.</li>}
                {writingN > 0 && <li><b>{writingN} are still writing:</b> they get a second sitting only after they finish the one they are on.</li>}
              </ul>
              <label className="field"><span>Reason (kept in the audit log)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Was ill, phone broke, no network" autoFocus /></label>
              {writingN > 0 && <label className="switch"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand that {writingN} student{writingN === 1 ? "" : "s"} still writing will get a second sitting.</label>}
            </>
          ) : (
            <>
              <h2>Take back permission for {allowedN} student{allowedN === 1 ? "" : "s"}?</h2>
              <p>They will no longer be able to start this exam. A student who has already started keeps her attempt.</p>
            </>
          )}
          {askErr && <p className="no" role="alert">⚠ {askErr}</p>}
          <div className="row">
            <button type="button" className="btn primary" disabled={working || (ask === "grant" && (reason.trim().length < 3 || (writingN > 0 && !sure)))} onClick={submitAsk}>{working ? "Working…" : ask === "grant" ? "Allow to sit" : "Take back"}</button>
            <button type="button" className="btn" disabled={working} onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  );
}
