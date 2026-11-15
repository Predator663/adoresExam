"use client";
/* Adding students from a file, in four calm steps: 1 set up (which class, a few options) · 2 template and file · 3 check · 4 done.
   Nothing is created until the person confirms on the check screen. Settings are remembered on this device. */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon from "./Icon";
import { CountUp, useLoad } from "./ui";
import { api, downloadFile } from "@/lib/api";
import "./upload.css";

type Prefs = { mode: "one" | "many"; tidy: boolean; existing: "reject" | "skip"; createClasses: boolean; style: "first" | "first.last"; parents: "0" | "1" | "2"; format: "xlsx" | "csv" };
const DEFAULTS: Prefs = { mode: "one", tidy: true, existing: "reject", createClasses: true, style: "first", parents: "1", format: "xlsx" };
const KEY = "amani_upload_prefs";
const loadPrefs = (): Prefs => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window */ } };

const STEPS = ["Set up", "File", "Check", "Done"];
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const stagger = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;

function Stepper({ step, go }: { step: number; go: (n: number) => void }) {
  return (
    <ol className="up-steps" aria-label="Progress" style={{ "--p": step / (STEPS.length - 1) } as CSSProperties}>
      <li className="up-line" aria-hidden><i /></li>
      {STEPS.map((l, i) => (
        <li key={l} className={i < step ? "done" : i === step ? "cur" : ""} aria-current={i === step ? "step" : undefined}>
          <button type="button" disabled={i >= step || step === 3} onClick={() => go(i)} aria-label={`${l}${i < step ? " (go back)" : ""}`}>
            <span>{i < step ? <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : i + 1}</span><small>{l}</small>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Seg<T extends string>({ value, onChange, opts, label }: { value: T; onChange: (v: T) => void; opts: [T, string][]; label: string }) {
  const i = Math.max(0, opts.findIndex((o) => o[0] === value));
  return (
    <div className="up-seg" role="radiogroup" aria-label={label} style={{ "--n": opts.length, "--k": i } as CSSProperties}>
      <i aria-hidden />
      {opts.map(([v, t]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  );
}

function Setting({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <div className="up-set"><div className="up-set-t"><b>{title}</b>{hint && <small>{hint}</small>}</div>{children}</div>;
}

const Switch = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) =>
  <button type="button" role="switch" aria-checked={on} aria-label={label} className={`up-switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>;

export default function StudentUpload() {
  const [step, setStep] = useState(0), [p, setP] = useState<Prefs>(DEFAULTS), [ready, setReady] = useState(false);
  const [cls, setCls] = useState(""), [newOn, setNewOn] = useState(false), [newName, setNewName] = useState(""), [newStream, setNewStream] = useState(""), [more, setMore] = useState(false);
  const [file, setFile] = useState<File | null>(null), [drag, setDrag] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [report, setReport] = useState<any>(null), [done, setDone] = useState<any>(null), [openProb, setOpenProb] = useState(false), [openWarn, setOpenWarn] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const opts = useLoad(() => api<{ classes: { id: number; label: string; form_level: number; students: number }[] }>("/students/bulk-upload/options/"));
  useEffect(() => { setP(loadPrefs()); setReady(true); }, []);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((o) => { const n = { ...o, [k]: v }; savePrefs(n); return n; });
  const one = p.mode === "one";
  const picked = useMemo(() => opts.data?.classes.find((c) => String(c.id) === cls), [opts.data, cls]);
  const newBad = newOn && !/[0-4]|pre[\s-]*form/i.test(newName);
  const classOk = !one || (newOn ? !!newName.trim() && !newBad : !!cls);
  const classLabel = !one ? "the class written on each row" : newOn ? `${newName.trim() || "a new class"} ${newStream.trim().toUpperCase()}`.trim() : picked?.label || "";

  const query = () => {
    const q = new URLSearchParams({ parents: p.parents, format: p.format });
    if (one && !newOn && cls) q.set("class", cls);
    return q;
  };
  async function template() {
    setErr("");
    try { await downloadFile(`/students/bulk-upload/template/?${query()}`, `students_template.${p.format}`); } catch (e: any) { setErr(e.message); }
  }

  async function check(f: File) {
    setErr(""); setReport(null);
    if (!/\.(csv|xlsx)$/i.test(f.name)) { setErr("Please choose the template as an Excel (.xlsx) or CSV (.csv) file."); return; }
    if (f.size > 5 * 1048576) { setErr("That file is larger than 5 MB. Split it into smaller files."); return; }
    setFile(f); setBusy(true);
    const fd = new FormData();
    fd.append("file", f); fd.append("tidy", p.tidy ? "1" : "0"); fd.append("existing", p.existing); fd.append("username_style", p.style);
    fd.append("create_classes", p.createClasses || newOn ? "1" : "0");
    if (one && !newOn && cls) fd.append("class", cls);
    if (one && newOn) { fd.append("class_name", newName.trim()); fd.append("class_stream", newStream.trim()); }
    try { setReport(await api<any>("/students/bulk-upload/validate/", { body: fd })); setStep(2); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e: any) { setErr(e.message); setFile(null); }
    setBusy(false);
  }
  async function create() {
    setBusy(true); setErr("");
    try { setDone(await api<any>(`/students/bulk-upload/${report.batch_id}/confirm/`, { body: { skip_invalid: true } })); setStep(3); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  const again = () => { setStep(1); setFile(null); setReport(null); setDone(null); setErr(""); opts.reload(); };
  const sheet = (kind: "pdf" | "csv") => downloadFile(done.credentials_url.replace(/^\/api/, "") + `?file=${kind}`, `credentials.${kind}`).catch((e) => setErr(e.message));
  const problemsCsv = () => {
    const rows = [["Row", "Problems"], ...report.errors.map((x: any) => [x.row, x.problems.join("; ")])];
    const blob = new Blob(["﻿" + rows.map((r) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rows_to_fix.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!ready) return null;
  const r = report, maxCount = r ? Math.max(1, ...r.by_class.map((c: any) => c.count)) : 1;
  const cols = ["First name", "Last name", "Index number", ...(one ? [] : ["Class or form", "Stream"]), ...(p.parents !== "0" ? ["Parent name", "Parent phone", "Parent relationship"] : []), ...(p.parents === "2" ? ["Parent 2 …"] : [])];

  return (
    <div className="up">
      <Stepper step={step} go={(n) => { setStep(n); if (n < 2) setReport(null); }} />
      {err && <p className="up-err" role="alert"><Icon n="alert" size={18} /> {err}</p>}

      {step === 0 && (
        <section className="up-pane" key="s0">
          <h2>Who are you adding?</h2>
          <div className="up-modes" role="radiogroup" aria-label="How many classes">
            {([["one", "users", "One class", "Every student in the file joins the class you pick. The file needs no class column."], ["many", "layers", "Several classes", "The file says which class each student is in."]] as const).map(([k, ic, t, s], i) => (
              <button key={k} type="button" role="radio" aria-checked={p.mode === k} className={`up-mode ${p.mode === k ? "on" : ""}`} style={stagger(i)} onClick={() => set("mode", k)}>
                <span className="up-ic"><Icon n={ic} size={24} /></span><b>{t}</b><small>{s}</small><i className="up-tick" aria-hidden><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i>
              </button>
            ))}
          </div>

          {one && (
            <div className="up-classes">
              <h3>Which class?</h3>
              {opts.loading ? <div className="up-skel"><i /><i /><i /><i /></div> : (
                <div className="up-cgrid" role="radiogroup" aria-label="Class">
                  {opts.data?.classes.map((c, i) => (
                    <button key={c.id} type="button" role="radio" aria-checked={!newOn && cls === String(c.id)} className={`up-class ${!newOn && cls === String(c.id) ? "on" : ""}`} style={stagger(i)} onClick={() => { setCls(String(c.id)); setNewOn(false); }}>
                      <b>{c.label}</b><small>{c.students} student{c.students === 1 ? "" : "s"}</small><i className="up-tick" aria-hidden><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i>
                    </button>
                  ))}
                  <button type="button" role="radio" aria-checked={newOn} className={`up-class new ${newOn ? "on" : ""}`} style={stagger(opts.data?.classes.length || 0)} onClick={() => { setNewOn(true); setCls(""); }}>
                    <b><Icon n="plus" size={16} /> New class</b><small>Create it now</small>
                  </button>
                </div>
              )}
              {newOn && (
                <div className="up-new">
                  <label className="field"><span>Class name</span><input className="input" value={newName} maxLength={40} placeholder="Form 2" onChange={(e) => setNewName(e.target.value)} autoFocus /></label>
                  <label className="field"><span>Stream (optional)</span><input className="input" value={newStream} maxLength={20} placeholder="A" onChange={(e) => setNewStream(e.target.value)} /></label>
                  {newBad && <p className="up-hint warn">The name needs a form number from 0 to 4, for example “Form 2”.</p>}
                </div>
              )}
            </div>
          )}

          <button type="button" className={`up-more ${more ? "open" : ""}`} aria-expanded={more} onClick={() => setMore((v) => !v)}><Icon n="sliders" size={18} /> More control<span className="grow" /><Icon n="chevron" size={18} /></button>
          <div className={`up-collapse ${more ? "open" : ""}`}><div>
            <div className="up-sets">
              <Setting title="Tidy names" hint="AMINA juma → Amina Juma"><Switch on={p.tidy} onChange={(v) => set("tidy", v)} label="Tidy names" /></Setting>
              <Setting title="Index numbers already in the system" hint="Handy when you upload the same list again"><Seg value={p.existing} onChange={(v) => set("existing", v)} label="Known index numbers" opts={[["reject", "Flag as a problem"], ["skip", "Skip them"]]} /></Setting>
              {!one && <Setting title="Create classes that are new" hint="Off: rows with an unknown class are flagged"><Switch on={p.createClasses} onChange={(v) => set("createClasses", v)} label="Create new classes" /></Setting>}
              <Setting title="Login names" hint="How each student signs in"><Seg value={p.style} onChange={(v) => set("style", v)} label="Login names" opts={[["first", "amina, amina2"], ["first.last", "amina.juma"]]} /></Setting>
              <Setting title="Parents in the template" hint="Optional columns to link parents"><Seg value={p.parents} onChange={(v) => set("parents", v)} label="Parents in the template" opts={[["0", "None"], ["1", "One"], ["2", "Two"]]} /></Setting>
              <Setting title="Template type" hint="Excel has a class drop-down and tips"><Seg value={p.format} onChange={(v) => set("format", v)} label="Template type" opts={[["xlsx", "Excel"], ["csv", "CSV"]]} /></Setting>
            </div>
          </div></div>

          <div className="up-actions"><button type="button" className="btn primary big" disabled={!classOk} onClick={() => setStep(1)}>Continue <Icon n="arrow" size={18} /></button></div>
        </section>
      )}

      {step === 1 && (
        <section className="up-pane" key="s1">
          <p className="up-for"><Icon n="users" size={16} /> Adding to <b>{classLabel}</b></p>
          <div className="up-two">
            <div className="up-card">
              <span className="up-ic"><Icon n="file" size={24} /></span>
              <h3>1 · Get the template</h3>
              <p className="muted small">Columns: {cols.join(" · ")}</p>
              <button type="button" className="btn primary" onClick={template}><Icon n="download" size={18} /> Download {p.format === "xlsx" ? "Excel" : "CSV"} template</button>
              <p className="up-hint">Already have a list? Skip this. Column names like Surname, Class or Index No are understood too.</p>
            </div>
            <div className="up-card">
              <span className="up-ic"><Icon n="upload" size={24} /></span>
              <h3>2 · Upload the filled file</h3>
              <div className={`up-drop ${drag ? "drag" : ""} ${busy ? "busy" : ""}`} role="button" tabIndex={0} aria-label="Choose the file to upload"
                onClick={() => !busy && inp.current?.click()} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); inp.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && !busy) check(f); }}>
                {busy ? <><span className="up-bars" aria-hidden><i /><i /><i /><i /></span><b>Checking {file?.name}…</b><small>Nothing is created yet.</small></> : <>
                  <span className="up-drop-ic" aria-hidden><Icon n="upload" size={34} /></span><b>{drag ? "Drop it here" : "Drop the file here"}</b><small>or tap to choose · .xlsx or .csv · up to 5 MB</small></>}
                <input ref={inp} type="file" hidden accept=".csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) check(f); }} />
              </div>
              {file && !busy && <p className="up-file"><Icon n="file" size={16} /> {file.name} <small>{size(file.size)}</small></p>}
            </div>
          </div>
          <div className="up-actions"><button type="button" className="btn" onClick={() => setStep(0)}>← Back</button></div>
        </section>
      )}

      {step === 2 && r && (
        <section className="up-pane" key="s2">
          <p className="up-for"><Icon n="file" size={16} /> {file?.name}</p>
          <div className="up-tiles">
            {([["good", "check", r.valid_rows, "Ready to create"], ["info", "refresh", r.skipped, "Already registered, skipped"], [r.invalid_rows ? "bad" : "", "alert", r.invalid_rows, "Need fixing"], ["", "file", r.total_rows, "Rows in the file"]] as [string, string, number, string][]).map(([tone, ic, n, l], i) => (
              <div key={l} className={`up-tile ${tone}`} style={stagger(i)}><span><Icon n={ic} size={18} /></span><b><CountUp to={n} /></b><small>{l}</small></div>
            ))}
          </div>

          {r.new_classes.length > 0 && <p className="up-note"><Icon n="plus" size={16} /> New {r.new_classes.length === 1 ? "class" : "classes"} will be created: {r.new_classes.map((c: string) => <b key={c} className="up-chip">{c}</b>)}</p>}
          {r.invalid_rows > 0 && r.valid_rows > 0 && <p className="up-note warn"><Icon n="alert" size={16} /> The {r.invalid_rows} row{r.invalid_rows === 1 ? "" : "s"} with problems will be left out. Fix them and upload them again afterwards.</p>}
          {r.valid_rows === 0 && <p className="up-note bad"><Icon n="alert" size={16} /> No row can be created yet. Fix the problems below and upload the file again.</p>}

          {r.by_class.length > 0 && (
            <div className="up-card flat"><h3>Students by class</h3>
              {r.by_class.map((c: any, i: number) => (
                <div key={c.class} className="up-cls" style={stagger(i)}><span className="up-cls-n">{c.class}{c.is_new && <em>new</em>}</span><span className="up-cls-bar"><i style={{ "--w": `${(c.count / maxCount) * 100}%` } as CSSProperties} /></span><b>{c.count}</b></div>))}
            </div>
          )}

          {r.preview.length > 0 && (
            <div className="up-card flat"><h3>What will be created</h3>
              <div className="tbl-wrap"><table className="up-table"><thead><tr><th>Name</th><th>Index</th><th>Class</th><th>Login name</th></tr></thead><tbody>
                {r.preview.map((x: any, i: number) => <tr key={i} style={stagger(i)}><td>{x.first_name} {x.last_name}</td><td>{x.index_number}</td><td>{x.class}</td><td><code>{x.username}</code></td></tr>)}
              </tbody></table></div>
              {r.valid_rows > r.preview.length && <p className="muted small">Showing {r.preview.length} of {r.valid_rows}.</p>}
            </div>
          )}

          {r.errors.length > 0 && (
            <div className="up-card flat bad">
              <button type="button" className="up-acc" aria-expanded={openProb} onClick={() => setOpenProb((v) => !v)}><b>{r.errors.length} row{r.errors.length === 1 ? "" : "s"} to fix</b><span className="grow" /><Icon n="chevron" size={18} /></button>
              <div className={`up-collapse ${openProb || r.errors.length <= 3 ? "open" : ""}`}><div>
                <ul className="up-probs">{r.errors.slice(0, 50).map((x: any) => <li key={x.row}><b>Row {x.row}</b><span>{x.problems.join("; ")}</span></li>)}</ul>
                {r.errors.length > 50 && <p className="muted small">Showing the first 50. Download the list for the rest.</p>}
                <button type="button" className="btn" onClick={problemsCsv}><Icon n="download" size={16} /> Download the list</button>
              </div></div>
            </div>
          )}
          {r.warnings?.length > 0 && (
            <div className="up-card flat">
              <button type="button" className="up-acc" aria-expanded={openWarn} onClick={() => setOpenWarn((v) => !v)}><b>⚠ {r.warnings.length} parent note{r.warnings.length === 1 ? "" : "s"}</b><span className="grow" /><Icon n="chevron" size={18} /></button>
              <div className={`up-collapse ${openWarn || r.warnings.length <= 3 ? "open" : ""}`}><div><ul className="up-probs">{r.warnings.slice(0, 50).map((x: any) => <li key={x.row}><b>Row {x.row}</b><span>{x.problems.join("; ")}</span></li>)}</ul></div></div>
            </div>
          )}
          {r.parents?.links > 0 && <p className="up-note"><Icon n="phone" size={16} /> {r.parents.links} parent link{r.parents.links === 1 ? "" : "s"} will be made ({r.parents.parents_new} new parent{r.parents.parents_new === 1 ? "" : "s"}, {r.parents.parents_existing} already known).</p>}

          <div className="up-actions sticky">
            <button type="button" className="btn" onClick={() => { setStep(1); setReport(null); }}>← Another file</button>
            <button type="button" className="btn primary big grow" disabled={busy || !r.valid_rows} onClick={create}>{busy ? <><i className="spinner" aria-hidden /> Creating…</> : `Create ${r.valid_rows} account${r.valid_rows === 1 ? "" : "s"}`}</button>
          </div>
        </section>
      )}

      {step === 3 && done && (
        <section className="up-pane up-done" key="s3">
          <div className="up-burst" aria-hidden>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--a": `${i * 30}deg`, "--i": i } as CSSProperties} />)}<span><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span></div>
          <h2><CountUp to={done.created} /> account{done.created === 1 ? "" : "s"} created</h2>
          <p className="muted">{r?.by_class?.map((c: any) => `${c.count} in ${c.class}`).join(" · ")}</p>
          <p className="up-note warn"><Icon n="lock" size={16} /> The sheet shows each student’s starting password. Print it, hand it out, and keep it safe.</p>
          <div className="up-dl">
            <button type="button" className="btn primary big" onClick={() => sheet("pdf")}><Icon n="download" size={18} /> Printable sheet (PDF)</button>
            <button type="button" className="btn big" onClick={() => sheet("csv")}><Icon n="download" size={18} /> Spreadsheet (CSV)</button>
          </div>
          {done.parents && <p className="up-note"><Icon n="phone" size={16} /> {done.parents.links_created} parent link{done.parents.links_created === 1 ? "" : "s"} made. <Link href="/staff/guardians/">Send them their children’s login details →</Link></p>}
          <div className="up-actions"><button type="button" className="btn" onClick={again}><Icon n="plus" size={16} /> Add more students</button><Link className="btn" href="/staff/people/">See people</Link></div>
        </section>
      )}
    </div>
  );
}
