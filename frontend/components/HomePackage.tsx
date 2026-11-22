"use client";
/* Admin: print the home package of an exam (live, closed or published) for students without a smartphone or internet.
   1. Choose the students. 2. "Create codes": each gets her own unique code (kept if she already has one). 3. Print.
   Server: exams/paper.py. The scan / answer-entry screen is /staff/paper/ (PaperScan). */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PaperPrint from "@/components/PaperPrint";
import { useLoad } from "@/components/ui";
import { api, friendly } from "@/lib/api";
import { eatDate } from "@/lib/clock";
import type { PackData, PackStudent } from "@/lib/paper";
import "./paper.css";

const badge = (s: PackStudent) =>
  s.online ? "Sat online" : !s.sheet ? "No package yet" : s.sheet.entered_at ? "✓ Marks entered" : s.sheet.received_at ? "Received" : "Code made";

export default function HomePackage() {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => { const v = new URLSearchParams(location.search).get("id"); setId(v && /^\d+$/.test(v) ? Number(v) : 0); }, []);
  const pack = useLoad<PackData | null>(() => (id ? api<PackData>(`/exams/${id}/paper-package/`) : Promise.resolve(null)), [id]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cls, setCls] = useState<number | "all">("all"), [q, setQ] = useState("");
  const [stage, setStage] = useState<"pick" | "print">("pick"), [busy, setBusy] = useState(false), [err, setErr] = useState("");

  const d = pack.data;
  const classes = useMemo(() => {
    const m = new Map<number, string>();
    d?.students.forEach((s) => { if (s.class_id != null) m.set(s.class_id, s.class); });
    return [...m.entries()];
  }, [d]);
  const shown = useMemo(() => (d?.students || []).filter((s) => (cls === "all" || s.class_id === cls) && (!q.trim() || `${s.name} ${s.index}`.toLowerCase().includes(q.trim().toLowerCase()))), [d, cls, q]);
  const pickable = shown.filter((s) => !s.online);

  const toggle = (s: PackStudent) => { if (s.online) return; const n = new Set(sel); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setSel(n); };
  const allShown = pickable.length > 0 && pickable.every((s) => sel.has(s.id));
  const toggleShown = () => { const n = new Set(sel); pickable.forEach((s) => (allShown ? n.delete(s.id) : n.add(s.id))); setSel(n); };

  async function make() {
    setBusy(true); setErr("");
    try {
      const rows = await api<{ student_id: number; code: string; pretty: string; received_at: string | null; entered_at: string | null }[]>(`/exams/${id}/paper-sheets/`, { body: { students: [...sel] } });
      const by = new Map(rows.map((r) => [r.student_id, r]));
      pack.setData((p) => p && { ...p, students: p.students.map((s) => { const r = by.get(s.id); return r ? { ...s, sheet: { code: r.code, pretty: r.pretty, received_at: r.received_at, entered_at: r.entered_at } } : s; }) });
      setStage("print");
      window.scrollTo({ top: 0 });
    } catch (e: any) { setErr(friendly(e)); }
    setBusy(false);
  }

  if (id === null || (pack.loading && !d)) return <p className="muted">Loading…</p>;
  if (!id) return <p>Open this page from an exam: Exams, choose the exam, then “Home package”.</p>;
  if (pack.error && !d) return <p className="no" role="alert">⚠ {pack.error}</p>;
  if (!d) return null;

  const chosen = d.students.filter((s) => sel.has(s.id) && s.sheet);

  if (stage === "print") {
    return (
      <div className="hp">
        <div className="card no-print">
          <h2>Ready to print: {chosen.length} {chosen.length === 1 ? "package" : "packages"}</h2>
          <p className="muted">Every student has her own code, printed on every page and as a barcode on her cover and answer sheet. Print on A4. Each package starts on a new page: cover, questions, answer sheet.</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => window.print()}>🖨 Print {chosen.length} {chosen.length === 1 ? "package" : "packages"}</button>
            <button type="button" className="btn" onClick={() => setStage("pick")}>← Choose other students</button>
            <Link className="btn" href="/staff/paper/">Scan returned sheets</Link>
          </div>
          <p className="muted small">Tip: in the print window choose “A4”, and leave “Headers and footers” off. Print a single package first to check it.</p>
        </div>
        <PaperPrint data={d} students={chosen} />
      </div>
    );
  }

  return (
    <div className="hp">
      <div className="card">
        <h2>Home package: {d.exam.title}</h2>
        <p className="muted">{d.exam.subject} · {d.questions.length} questions · {d.exam.total_marks} marks{d.exam.end_at ? ` · closes ${eatDate(d.exam.end_at)}` : ""}</p>
        <div className="hp-stats">
          <div className="hp-stat"><b>{d.counts.sheets}</b>packages made</div>
          <div className="hp-stat"><b>{d.counts.received}</b>received back</div>
          <div className="hp-stat"><b>{d.counts.entered}</b>marks entered</div>
        </div>
        <p className="row" style={{ marginTop: ".8rem" }}><Link className="btn" href="/staff/paper/">📷 Scan returned sheets</Link></p>
      </div>

      <div className="card">
        <h3>Who gets a package?</h3>
        <label className="field"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" /></label>
        <div className="hp-chips" role="group" aria-label="Class">
          <button type="button" className={`chip ${cls === "all" ? "on" : ""}`} onClick={() => setCls("all")}>All classes</button>
          {classes.map(([cid, name]) => <button key={cid} type="button" className={`chip ${cls === cid ? "on" : ""}`} onClick={() => setCls(cid)}>{name}</button>)}
        </div>
        <p className="row" style={{ margin: ".6rem 0" }}>
          <button type="button" className="btn" onClick={toggleShown} disabled={!pickable.length}>{allShown ? "Clear these" : `Select these ${pickable.length}`}</button>
          <span className="muted small">{sel.size} selected</span>
        </p>
        <div className="hp-list">
          {shown.map((s) => (
            <label key={s.id} className={`hp-row ${s.online ? "off" : ""}`}>
              <input type="checkbox" checked={sel.has(s.id)} disabled={s.online} onChange={() => toggle(s)} />
              <span className="who"><b>{s.name}</b><span className="muted small">{s.class || "-"}{s.index ? ` · ${s.index}` : ""}{s.sheet ? ` · ${s.sheet.pretty}` : ""}</span></span>
              <span className="hp-badge">{badge(s)}</span>
            </label>
          ))}
          {!shown.length && <p className="muted">No students match.</p>}
        </div>
      </div>

      {err && <p className="no" role="alert">⚠ {err}</p>}
      <div className="hp-bar">
        <span className="grow">{sel.size ? `${sel.size} selected` : "Choose the students first"}</span>
        <button type="button" className="btn primary" disabled={!sel.size || busy} onClick={make}>{busy ? "Preparing…" : `Create codes and prepare ${sel.size || ""} ${sel.size === 1 ? "package" : "packages"}`}</button>
      </div>
    </div>
  );
}
