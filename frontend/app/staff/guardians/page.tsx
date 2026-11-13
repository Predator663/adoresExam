"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Pager, useClientPage, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import { ErrorNote, Loading, Modal, Tabs, useLoad } from "@/components/ui";
import { api, apiBase, downloadFile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { classLabel } from "@/lib/staff";
import { Avatar, Bubble, Count, Dist, Empty, fmtDur, loadTemplates, saveTemplates, SkeletonRows, smsParts, Stat, StatusPill, useConfirm, useCopy, useToasts, type Ask, type Toast } from "@/components/sms";
import "./sms.css";

type Tools = { toast: Toast; ask: Ask };

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const Status = StatusPill;
const delay = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;
const Msg = ({ err, ok }: { err?: string; ok?: string }) => <>{err && <p className="no" role="alert">⚠ {err}</p>}{ok && <p className="ok" role="status">✓ {ok}</p>}</>;

/* ------------------------------------------------------------------------------------------- Parents */
function Parents({ summary, classes, reload, toast, ask }: { summary: any; classes: any[]; reload: () => void } & Tools) {
  const [q, setQ] = useState(""), [qIn, setQIn] = useState(""), [cls, setCls] = useState("");
  useEffect(() => { const h = setTimeout(() => setQ(qIn), 250); return () => clearTimeout(h); }, [qIn]);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {  // press "/" anywhere to jump to the search box
    const h = (e: KeyboardEvent) => { const el = document.activeElement as HTMLElement | null; if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(el?.tagName || "") && !el?.isContentEditable) { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  const [edit, setEdit] = useState<any>(null), [add, setAdd] = useState(false), [shown, setShown] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<Record<number, any>>({}), [resend, setResend] = useState<any[] | null>(null);  // picked: parents ticked for "send login details again"
  const tick = (g: any) => setPicked((p) => { const n = { ...p }; if (n[g.id]) delete n[g.id]; else n[g.id] = g; return n; });
  const pickedList = Object.values(picked);
  const list = usePaged<any>("/guardians/", { q, class: cls }, { size: 20 });
  const { copy, done: copied } = useCopy(toast);
  const done = (ok: string) => { toast.ok(ok); list.reload(); reload(); };
  const fail = (e: any) => toast.err(e.message);
  async function reveal(id: number) {
    try { const r = await api<any>(`/guardians/${id}/reveal/`); setShown((s) => ({ ...s, [id]: r.phone })); setTimeout(() => setShown((s) => { const n = { ...s }; delete n[id]; return n; }), 15000); } catch (e) { fail(e); }
  }
  const d = list.data;
  return (
    <>
      <div className="grid3">
        <Stat n={summary.parents} icon="👪" label="Parents saved" />
        <Stat n={summary.students_with_parent} of={summary.students} icon="🔗" label="Students with a parent" tone={summary.students_with_parent < summary.students ? "warn" : "good"} />
        <Stat n={summary.students_waiting_first_login} icon="🔑" label="Waiting for first login" />
      </div>
      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: ".6rem" }}>
          <input ref={search} className="input grow" type="search" placeholder="Search parent, child or phone   ( / )" aria-label="Search" value={qIn} onChange={(e) => setQIn(e.target.value)} />
          <select className="input" aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select>
          <button className="btn primary" onClick={() => setAdd(true)}>+ Add a parent</button>
        </div>
      </div>
      {list.loading ? <SkeletonRows /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.rows.length ? (
        d.total || q || cls
          ? <Empty icon="🔍" title="No parents match">Try a shorter name, or choose “All classes”.<div className="row"><button className="btn" onClick={() => { setQIn(""); setCls(""); }}>Clear the search</button></div></Empty>
          : <Empty icon="📇" title="No parents yet">Upload your list of parents, or add the first one by hand.<div className="row"><button className="btn primary" onClick={() => setAdd(true)}>+ Add a parent</button></div></Empty>
      ) : (
        <>
          <div className="tbl-wrap paged" ref={list.top} aria-busy={list.busy || undefined}><table>
            <thead><tr><th><input type="checkbox" aria-label="Select everyone on this page" checked={list.rows.length > 0 && list.rows.every((g: any) => picked[g.id])} onChange={(e) => setPicked((p) => { const n = { ...p }; list.rows.forEach((g: any) => { if (e.target.checked) n[g.id] = g; else delete n[g.id]; }); return n; })} /></th><th>Parent</th><th>Phone</th><th>Children</th><th>Last message</th><th></th></tr></thead>
            <tbody>{list.rows.map((g: any, ix: number) => (
              <tr key={g.id} className={`sms-row ${picked[g.id] ? "picked" : ""}`} style={delay(ix)}>
                <td><input type="checkbox" aria-label={`Select ${g.name}`} checked={!!picked[g.id]} onChange={() => tick(g)} /></td>
                <td><div className="sms-who"><Avatar name={g.name} /><div><b>{g.name}</b><br /><span className="muted small">{g.relationship || "—"}{g.has_whatsapp ? " · WhatsApp" : ""} · {g.language === "en" ? "English" : "Kiswahili"}</span></div></div></td>
                <td><span className="mono">{shown[g.id] || g.phone}</span> {!shown[g.id] ? <button className="btn ghost" onClick={() => reveal(g.id)} aria-label={`Show phone of ${g.name}`}>Show</button> : <button className="btn ghost" onClick={() => copy(`p${g.id}`, shown[g.id])} aria-label={`Copy phone of ${g.name}`}>{copied === `p${g.id}` ? "Copied ✓" : "Copy"}</button>}</td>
                <td>{g.children.map((c: any) => <span key={c.id} className="pill" title={c.class}>{c.name}{c.logged_in ? " ✓" : ""}</span>)} </td>
                <td>{g.last_message ? <><Status s={g.last_message.status} /><br /><span className="muted small">{when(g.last_message.at)}</span></> : <span className="muted">none</span>}</td>
                <td><button className="btn" onClick={() => setEdit(g)}>Edit</button></td>
              </tr>))}</tbody>
          </table></div>
          <p className="muted small">✓ = the child has already logged in. Tick parents whose message did not arrive (for example a wrong number), then press “Send login details again”.</p>
          <Pager {...list.pager} />
          {pickedList.length > 0 && (
            <div className="sms-sel" role="region" aria-label="Selected parents">
              <span className="grow"><b><Count n={pickedList.length} /></b> parent{pickedList.length > 1 ? "s" : ""} selected</span>
              <button className="btn" onClick={() => setResend(pickedList)}>Send login details again</button>
              <button className="btn ghost" onClick={() => setPicked({})}>Clear</button>
            </div>
          )}
        </>
      )}
      {summary.without_parent?.length > 0 && (
        <details className="card"><summary><b>{summary.students - summary.students_with_parent} students have no parent yet</b></summary>
          <p className="muted small">First 40 shown. Add them in the Upload tab or with “Add a parent”.</p>
          <p>{summary.without_parent.map((s: any) => <span key={s.id} className="pill">{s.name} · {s.index} · {s.class}</span>)}</p></details>
      )}
      {add && <AddParent onClose={() => setAdd(false)} onDone={() => { setAdd(false); done("Parent saved."); }} />}
      {edit && <EditParent ask={ask} g={edit} onClose={() => setEdit(null)} onDone={(m: string, changed?: any) => { setEdit(null); done(m); if (changed) setResend([changed]); }} />}
      {resend && <ResendModal ask={ask} parents={resend} onClose={() => setResend(null)}
        onDone={(m: string) => { setResend(null); setPicked({}); done(m); }} />}
    </>
  );
}

function AddParent({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", relationship: "", student_index: "", has_whatsapp: false, language: "sw" }), [err, setErr] = useState("");
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  return (
    <Modal label="Add a parent" onClose={onClose}>
      <h2>Add a parent</h2>
      <label className="field"><span>Parent name</span><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label className="field"><span>Mobile number</span><input className="input" inputMode="tel" placeholder="0712 345 678" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label className="field"><span>Relationship (optional)</span><input className="input" placeholder="mother, father, guardian" value={f.relationship} onChange={(e) => set("relationship", e.target.value)} /></label>
      <label className="field"><span>Child’s index number (several: separate with ;)</span><input className="input" value={f.student_index} onChange={(e) => set("student_index", e.target.value)} /></label>
      <label className="field"><span>Message language</span><select className="input" value={f.language} onChange={(e) => set("language", e.target.value)}><option value="sw">Kiswahili</option><option value="en">English</option></select></label>
      <label className="row"><input type="checkbox" checked={f.has_whatsapp} onChange={(e) => set("has_whatsapp", e.target.checked)} /> Uses WhatsApp</label>
      <Msg err={err} />
      <div className="row"><button className="btn primary grow" onClick={async () => { try { await api("/guardians/", { body: f }); onDone(); } catch (e: any) { setErr(e.message); } }}>Save</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

function EditParent({ g, onClose, onDone, ask }: { ask: Ask; g: any; onClose: () => void; onDone: (m: string, changed?: any) => void }) {
  const [f, setF] = useState({ name: g.name, phone: "", relationship: g.relationship, has_whatsapp: g.has_whatsapp, language: g.language }), [err, setErr] = useState(""), [idx, setIdx] = useState("");
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const run = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); onDone(ok, r?.phone_changed ? r : undefined); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal label="Edit parent" onClose={onClose}>
      <h2>Edit parent</h2>
      <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label className="field"><span>New mobile number (leave empty to keep {g.phone}). After saving you can send the login details to the new number.</span><input className="input" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label className="field"><span>Relationship</span><input className="input" value={f.relationship} onChange={(e) => set("relationship", e.target.value)} /></label>
      <label className="field"><span>Message language</span><select className="input" value={f.language} onChange={(e) => set("language", e.target.value)}><option value="sw">Kiswahili</option><option value="en">English</option></select></label>
      <label className="row"><input type="checkbox" checked={f.has_whatsapp} onChange={(e) => set("has_whatsapp", e.target.checked)} /> Uses WhatsApp</label>
      <h3>Children</h3>
      <p>{g.children.map((c: any) => <span key={c.id} className="pill">{c.name} ({c.index}) <button className="btn ghost" aria-label={`Remove ${c.name}`} onClick={() => run(() => api(`/guardians/${g.id}/links/?student=${c.id}`, { method: "DELETE" }), "Child removed.")}>✕</button></span>)}</p>
      <div className="row"><input className="input grow" placeholder="Add a child by index number" value={idx} onChange={(e) => setIdx(e.target.value)} />
        <button className="btn" disabled={!idx.trim()} onClick={() => run(() => api(`/guardians/${g.id}/links/`, { body: { student_index: idx } }), "Child added.")}>Add</button></div>
      <Msg err={err} />
      <div className="row"><button className="btn primary grow" onClick={() => run(() => api(`/guardians/${g.id}/`, { method: "PATCH", body: { ...f, phone: f.phone || undefined } }), "Saved.")}>Save</button>
        <button className="btn danger" onClick={async () => (await ask({ title: `Delete ${g.name}?`, body: "Messages already sent are not affected.", yes: "Delete", danger: true })) && run(() => api(`/guardians/${g.id}/`, { method: "DELETE" }), "Parent deleted.")}>Delete</button></div>
    </Modal>
  );
}

function ResendModal({ parents, onClose, onDone, ask }: { ask: Ask; parents: any[]; onClose: () => void; onDone: (m: string) => void }) {
  /* Send the login details again to chosen parents (a wrong number, a phone that was off, a message that never arrived).
     Only children who have NOT logged in yet get a new password; a child who has already logged in is never touched. */
  const ids = parents.map((p) => p.id);
  const body = { scope: "selected", guardian_ids: ids, include_sent: true };
  const [plan, setPlan] = useState<any>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api("/guardians/send/", { body }).then(setPlan).catch((e: any) => setErr(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function go() {
    setBusy(true);
    try { const r = await api<any>("/guardians/send/", { body: { ...body, dry_run: false } }); onDone(`${r.queued} message${r.queued === 1 ? " is" : "s are"} waiting for the phone to send. The children got NEW passwords; any earlier message with a password no longer works.`); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  const sk = plan?.skipped || {};
  return (
    <Modal label="Send login details again" onClose={onClose}>
      <h2>Send login details again</h2>
      <p className="muted">Use this when a message did not arrive, or after you corrected a phone number. The message goes to the parent’s <b>current</b> number shown below.</p>
      <ul>{parents.map((p) => <li key={p.id}><b>{p.name}</b> · <span className="mono">{p.phone}</span></li>)}</ul>
      {!plan && !err && <Loading />}
      {plan && (
        <div className="hint">
          <p><b>{plan.messages}</b> message{plan.messages === 1 ? "" : "s"} for <b>{plan.students}</b> {plan.students === 1 ? "child" : "children"}.</p>
          {(sk.already_logged_in || 0) > 0 && <p className="small muted">{sk.already_logged_in} child{sk.already_logged_in > 1 ? "ren have" : " has"} already logged in and will <b>not</b> get a new password.</p>}
          <p className="small muted">Each child listed gets a <b>new password</b>. The old text (including one sent to a wrong number) stops working, and a copy still waiting in the queue is cancelled.</p>
          {plan.preview?.text && <Bubble text={plan.preview.text} parts={plan.preview.parts} />}
          {plan.preview?.text && <p className="small muted">Example (password hidden). Each parent gets their own children’s details in the language on their record.</p>}
        </div>
      )}
      <Msg err={err} />
      <div className="row">
        <button className="btn primary grow" disabled={busy || !plan || !plan.messages} onClick={async () => (await ask({ title: `Send to ${plan.messages} parent${plan.messages === 1 ? "" : "s"}?`, body: `${plan.students} ${plan.students === 1 ? "child gets a new password" : "children get new passwords"}. Older texts stop working.`, yes: "Send now" })) && go()}>{busy ? "Queueing…" : "Send now"}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------- Upload */
function Upload({ reload, goParents, toast }: { reload: () => void; goParents: () => void } & Pick<Tools, "toast">) {
  const [file, setFile] = useState<File | null>(null), [rep, setRep] = useState<any>(null), [saved, setSaved] = useState(""), [skip, setSkip] = useState(false), [busy, setBusy] = useState(false), [drag, setDrag] = useState(false);
  const post = (confirm: boolean) => { const fd = new FormData(); fd.append("file", file!); fd.append("confirm", String(confirm)); fd.append("skip_invalid", String(skip)); return api<any>("/guardians/upload/", { body: fd }); };
  const pick = (f?: File | null) => { setFile(f || null); setRep(null); setSaved(""); };
  async function check() { setBusy(true); setSaved(""); try { setRep(await post(false)); } catch (e: any) { setRep(null); toast.err(e.message); } setBusy(false); }
  async function save() {
    setBusy(true);
    try { const r = await post(true); setSaved(`${r.parents_created} new parents, ${r.links_created} children linked${r.skipped ? `, ${r.skipped} rows skipped` : ""}.`); toast.ok("Parents saved."); setRep(null); setFile(null); reload(); } catch (e: any) { toast.err(e.message); }
    setBusy(false);
  }
  const problems = (rep?.rows || []).filter((r: any) => r.status !== "ok");
  function downloadProblems() {  // the rows that need fixing, as a file the teacher can correct and upload again
    const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["row,parent,phone,problems", ...problems.map((r: any) => [r.row, r.name, r.phone, (r.problems || []).join(" ")].map(q).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "rows_to_fix.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const step = saved ? 4 : rep ? 3 : file ? 2 : 1;
  return (
    <>
      <ol className="sms-steps" aria-label="Steps">{["Prepare the list", "Check the file", "Confirm"].map((n, i) => <li key={n} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}><b>{step > i + 1 ? "✓" : i + 1}</b><span>{n}</span></li>)}</ol>
      <div className="card">
        <h3>1. Prepare your list</h3>
        <p className="muted">One row per parent. Columns: <b>parent_name, phone, relationship, student_index, whatsapp, language</b>. For two daughters write both index numbers in one cell, separated by <b>;</b>. Phone numbers like 0712 345 678 or +255712345678 both work. The file is checked first: nothing is saved until you confirm.</p>
        <button className="btn" onClick={() => downloadFile("/guardians/template/", "parents_template.csv").catch((e) => toast.err(e.message))}>⬇ Download the template (CSV)</button>
      </div>
      <div className="card">
        <h3>2. Check the file</h3>
        <label className={`sms-drop ${drag ? "over" : ""} ${file ? "has" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}>
          <input className="sr-only" type="file" accept=".csv,.xlsx,.txt" aria-label="Parents file" onChange={(e) => pick(e.target.files?.[0])} />
          <span className="ic" aria-hidden>{file ? "📄" : "📥"}</span>
          {file ? <><b>{file.name}</b><span className="muted small">{(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB · tap to choose another file</span></>
            : <><b>Drop your file here, or tap to choose it</b><span className="muted small">CSV or Excel (.csv, .xlsx, .txt)</span></>}
        </label>
        {busy && !rep && <div className="sms-bar" role="progressbar" aria-label="Working"><i /></div>}
        <div className="row" style={{ marginTop: ".6rem" }}><button className="btn primary" disabled={!file || busy} onClick={check}>{busy && !rep ? "Checking…" : "Check the file"}</button></div>
        {saved && <div className="hint" role="status" style={{ marginTop: ".6rem" }}><p><b>✓ Saved:</b> {saved}</p><button className="btn" onClick={goParents}>See the parents →</button></div>}
      </div>
      {rep && (
        <div className="card sms-pane">
          <h3>3. Confirm</h3>
          <div className="grid3">
            <Stat n={rep.valid_rows} icon="✅" label="Rows OK" tone="good" /><Stat n={rep.invalid_rows} icon="⚠️" label="Rows with problems" tone={rep.invalid_rows ? "bad" : undefined} />
            <Stat n={rep.parents_new} icon="🆕" label="New parents" />
          </div>
          <div className="tbl-wrap"><table><thead><tr><th>Row</th><th>Parent</th><th>Phone</th><th>Children</th><th>Result</th></tr></thead><tbody>
            {rep.rows.map((r: any, ix: number) => (<tr key={r.row} className={`sms-row ${r.status === "ok" ? "" : "sms-bad"}`} style={delay(ix)}><td>{r.row}</td><td>{r.name || "—"}</td><td className="mono">{r.phone}</td><td>{r.students.join(", ") || "—"}</td>
              <td>{r.status === "ok" ? <span className="ok">✓ OK</span> : <span className={r.status === "error" ? "no" : "warn"}>{r.status === "error" ? "✗ " : "⚠ "}{r.problems.join(" ")}</span>}</td></tr>))}
          </tbody></table></div>
          {rep.invalid_rows > 0 && <div className="row" style={{ flexWrap: "wrap", marginTop: ".5rem" }}>
            <label className="row grow"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Skip the rows with problems and save the rest</label>
            <button className="btn" onClick={downloadProblems}>⬇ Rows to fix (CSV)</button></div>}
          <button className="btn primary big" style={{ marginTop: ".6rem" }} disabled={busy || rep.valid_rows === 0 || (rep.invalid_rows > 0 && !skip)} onClick={save}>{busy ? "Saving…" : `Save ${rep.valid_rows} rows`}</button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------- Send */
const QUICK: [string, string][] = [
  ["Parents' meeting", "Parents' meeting on [date], [time], at school. Your attendance is important."],
  ["Mkutano wa wazazi", "Mkutano wa wazazi utafanyika [tarehe], saa [saa], shuleni. Karibuni sana."],
  ["Fees reminder", "Reminder: the school fees balance is due by [date]. Thank you."],
  ["Shule inafunguliwa", "Shule inafunguliwa tarehe [tarehe]. Tafadhali wanafunzi wawahi."],
];
const FILTERS: [string, string][] = [["", "All"], ["queued", "Waiting"], ["sending", "Sending"], ["sent", "Sent"], ["delivered", "Delivered"], ["failed", "Failed"], ["cancelled", "Cancelled"]];

function Send({ summary, classes, reload, toast, ask }: { summary: any; classes: any[]; reload: () => void } & Tools) {
  const [again, setAgain] = useState<any[] | null>(null);  // a parent chosen from the messages list below
  const [scope, setScope] = useState("all"), [cls, setCls] = useState(""), [resend, setResend] = useState(false), [note, setNote] = useState(""), [plan, setPlan] = useState<any>(null), [checking, setChecking] = useState(false), [queueing, setQueueing] = useState(false);
  const defaults: Record<string, string> = summary.default_messages || {};
  const [includeLogin, setIncludeLogin] = useState(true), [lang, setLang] = useState<"sw" | "en">("sw");
  const [wording, setWording] = useState<Record<string, string | undefined>>({});  // what the administrator edited; untouched = the standard wording
  const text = (l: string) => wording[l] ?? defaults[l] ?? "";
  const edited = (l: string) => wording[l] !== undefined && wording[l] !== defaults[l];
  const noteMax = includeLogin ? 160 : 459;
  const [filter, setFilter] = useState("");
  const [mine, setMine] = useState<string[]>([]);
  useEffect(() => setMine(loadTemplates()), []);
  const jobs = usePaged<any>("/guardians/jobs/", { status: filter }, { size: 20 });
  const cfg = useLoad(() => api<any>("/guardians/config/"));
  const body = { scope, class_id: scope === "class" ? Number(cls) : undefined, resend: includeLogin && resend, note: note.trim(), include_login: includeLogin,
    ...(includeLogin ? { message_sw: text("sw"), message_en: text("en") } : {}) };
  const missingChildren = includeLogin && (!text("sw").includes("{children}") || !text("en").includes("{children}"));
  const placeholder = /\[[^\]]+\]/.test(note);  // "[date]" left in by mistake would go to every parent
  const sj = summary.jobs || {};
  const open = (sj.queued || 0) + (sj.sending || 0);
  const [peak, setPeak] = useState(0), [stamp, setStamp] = useState<Date | null>(null), [spin, setSpin] = useState(false);
  const was = useRef(0);
  useEffect(() => {
    setPeak((p) => (open ? Math.max(p, open) : 0));
    if (was.current > 0 && open === 0) toast.ok("All waiting messages have been handled.");
    was.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { setSpin(true); jobs.reload(); reload(); setStamp(new Date()); setTimeout(() => setSpin(false), 700); };
  useEffect(() => { if (!open) return; const i = setInterval(() => { if (!document.hidden) refresh(); }, 5000); return () => clearInterval(i); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = cfg.data, sb = Number(c?.seconds_between) || 8, pe = Number(c?.pause_every) || 30, ps = Number(c?.pause_seconds) || 180;
  const eta = open * sb + Math.floor(open / pe) * ps;
  const pct = peak ? Math.round((1 - open / peak) * 100) : 0;
  const mt = noteMax ? Math.min(100, (note.length / noteMax) * 100) : 0, local = smsParts(note);

  async function check() { setChecking(true); try { setPlan(await api("/guardians/send/", { body })); } catch (e: any) { setPlan(null); toast.err(e.message); } setChecking(false); }
  async function queue() {
    setQueueing(true);
    try { const r = await api<any>("/guardians/send/", { body: { ...body, dry_run: false } }); setPlan(null); setNote(""); toast.ok(`${r.queued} messages are waiting for the phone to send them.`); refresh(); } catch (e: any) { toast.err(e.message); }
    setQueueing(false);
  }
  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => { try { const r = await fn(); toast.ok(ok(r)); refresh(); } catch (e: any) { toast.err(e.message); } };
  const keep = () => { const t = note.trim(); if (!t || mine.includes(t)) return; const n = [t, ...mine].slice(0, 8); setMine(n); saveTemplates(n); toast.ok("Saved as a quick message on this browser."); };
  const drop = (t: string) => { const n = mine.filter((x) => x !== t); setMine(n); saveTemplates(n); };
  const sk = plan?.skipped || {};
  const fill = (t: string) => { setNote(t.slice(0, noteMax)); setPlan(null); };
  const shown = (k: string) => (k === "" ? (sj.queued || 0) + (sj.sending || 0) + (sj.sent || 0) + (sj.delivered || 0) + (sj.failed || 0) : k === "cancelled" ? undefined : sj[k] || 0);
  return (
    <>
      {open > 0 && (
        <div className={`sms-live ${summary.phone_online ? "" : "paused"}`} role="status" aria-live="polite">
          <div className="row" style={{ flexWrap: "wrap" }}>
            <b className="grow">{summary.phone_online ? "📤 Sending now" : "⏸ Waiting for the school phone"}</b>
            <span className="muted small"><Count n={open} /> left{summary.phone_online && c ? ` · ${fmtDur(eta)}` : ""}</span>
          </div>
          <div className="track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Sending progress"><i style={{ width: `${Math.max(pct, 3)}%` }} /></div>
          <div className="row small muted" style={{ flexWrap: "wrap" }}>
            <span className="grow">{summary.phone_online ? `${pct}% done. Messages go out slowly on purpose (about ${sb} seconds apart) so the SIM is not blocked.` : "Open the Amani SMS Sender app on the school phone. Sending continues by itself."}</span>
            <button className="btn ghost" onClick={refresh}><span className={spin ? "sms-refresh" : ""} aria-hidden>↻</span> Refresh</button>
          </div>
        </div>
      )}
      <div className="card">
        <h3>Send a message to parents</h3>
        <p className="muted">One text message per parent, sent by your school phone. {includeLogin
          ? <><b>Every child gets a new random password</b> (not her index number) and must choose her own at the first login. Children who have already logged in, or who were already sent a message, are skipped.</>
          : <>Only your own text is sent. <b>No password is created or changed</b>, and nobody is skipped because of an earlier message.</>}</p>
        {!summary.phone_online && <p className="warn" role="status">⚠ No school phone is online. Messages will wait until the phone app is open (see the Phone tab).</p>}
        <div className="sms-chips" role="group" aria-label="Kind of message">
          <button type="button" className={`sms-chip ${includeLogin ? "on" : ""}`} aria-pressed={includeLogin} onClick={() => { setIncludeLogin(true); setPlan(null); }}>🔑 Login details</button>
          <button type="button" className={`sms-chip ${!includeLogin ? "on" : ""}`} aria-pressed={!includeLogin} onClick={() => { setIncludeLogin(false); setPlan(null); }}>💬 My own message only</button>
        </div>
        <div className="grid2">
          <label className="field"><span>Send to</span><select className="input" value={scope} onChange={(e) => { setScope(e.target.value); setPlan(null); }}><option value="all">All parents</option><option value="class">Parents of one class</option></select></label>
          {scope === "class" && <label className="field"><span>Class</span><select className="input" value={cls} onChange={(e) => { setCls(e.target.value); setPlan(null); }}><option value="">Choose…</option>{classes.map((x) => <option key={x.id} value={x.id}>{classLabel(x)}</option>)}</select></label>}
        </div>
        {includeLogin && (
          <>
            <label className="row"><input type="checkbox" checked={resend} onChange={(e) => { setResend(e.target.checked); setPlan(null); }} /> Also send again to children who already have a message or have logged in (this gives them a NEW password)</label>
            <div className="field" style={{ marginTop: ".6rem" }}>
              <span>Message with the login details</span>
              <div className="row" role="tablist" aria-label="Language of the message">
                {([["sw", "Kiswahili"], ["en", "English"]] as const).map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={lang === k} className={"btn" + (lang === k ? " primary" : "")} onClick={() => setLang(k)}>{n}{edited(k) ? " ✎" : ""}</button>)}
              </div>
              <textarea className="input" rows={5} value={text(lang)} aria-label="Message wording" onChange={(e) => { setWording({ ...wording, [lang]: e.target.value }); setPlan(null); }} />
              <small className="muted">Each parent gets the language set on their record. Keep <code>{"{children}"}</code> (one line per child: name, user name, password) and <code>{"{url}"}</code> (the school web address); change the rest as you like.</small>
              {edited(lang) && <div><button type="button" className="btn small" onClick={() => { setWording({ ...wording, [lang]: undefined }); setPlan(null); }}>Restore the standard wording</button></div>}
              {missingChildren && <p className="warn" role="alert">⚠ Both messages must contain {"{children}"}, or parents would not receive the login details.</p>}
            </div>
          </>
        )}
        <div className="field" style={{ marginTop: ".6rem" }}>
          <span>{includeLogin ? "Extra message (optional)" : "Your message"}</span>
          <div className="sms-chips" aria-label="Quick messages">
            {QUICK.map(([n, t]) => <button key={n} type="button" className="sms-chip" onClick={() => fill(t)}>＋ {n}</button>)}
            {mine.map((t) => <span key={t} className="sms-chip" title={t}><button type="button" onClick={() => fill(t)}>⭐ {t.length > 26 ? `${t.slice(0, 26)}…` : t}</button><button type="button" aria-label="Remove this saved message" onClick={() => drop(t)}>✕</button></span>)}
          </div>
          <textarea className="input" rows={includeLogin ? 2 : 4} maxLength={noteMax} value={note} placeholder="For example: Parents' meeting on Friday 7 November, 9:00 am, at school." onChange={(e) => { setNote(e.target.value); setPlan(null); }} />
          <div className={`sms-meter ${mt > 100 ? "full" : mt > 85 ? "hot" : ""}`} aria-hidden><i style={{ width: `${mt}%` }} /></div>
          <div className="sms-count"><span>{note.length}/{noteMax}{!includeLogin && note ? ` · ${local.parts} SMS${local.unicode ? " (special character)" : ""}` : ""}</span>
            <span>{note.trim() && !mine.includes(note.trim()) ? <button type="button" className="btn ghost" style={{ minHeight: 32, padding: "0 .5rem" }} onClick={keep}>⭐ Save as quick message</button> : null}</span></div>
          <small className="muted">{includeLogin ? "Added as the last line of every message, after the login details. Leave it empty to send only the login details." : "This is the whole SMS, sent as you wrote it."} A longer text may use more than one SMS.</small>
          {placeholder && <p className="warn" role="alert">⚠ The message still has a [placeholder] such as [date]. Replace it before you send.</p>}
        </div>
        {!includeLogin && note.trim() && !plan && <div style={{ maxWidth: 300 }}><Bubble text={note.trim()} parts={local.parts} /></div>}
        <div className="row" style={{ marginTop: ".6rem" }}><button className="btn primary" disabled={checking || (scope === "class" && !cls) || missingChildren || placeholder || (!includeLogin && !note.trim())} onClick={check}>{checking ? "Checking…" : "Check who will get a message"}</button></div>
        {plan && (
          <div className="hint sms-plan" style={{ marginTop: ".7rem" }}>
            <div>
              <p><b><Count n={plan.messages} /></b> messages for <b><Count n={plan.students} /></b> children.</p>
              <p className="small muted">Skipped: {includeLogin ? `${sk.already_logged_in || 0} already logged in · ${sk.already_sent || 0} already sent · ` : ""}{sk.no_children || 0} parents with no child · {sk.inactive || 0} inactive.</p>
              {plan.messages > 0 && c && <p className="small muted">⏱ At the current pace the phone needs {fmtDur(plan.messages * sb + Math.floor(plan.messages / pe) * ps)}.</p>}
              {plan.preview?.unicode && <p className="warn" role="status">⚠ The message has a character (such as an emoji) that makes each SMS shorter and costs more. Use plain letters to keep it cheap.</p>}
              <button className="btn primary big" disabled={!plan.messages || queueing} onClick={async () => (await ask({ title: `Queue ${plan.messages} messages?`, body: plan.login === false ? "No passwords change." : `${plan.students} children get new passwords. Older texts stop working.`, yes: `Queue ${plan.messages} messages` })) && queue()}>{queueing ? "Queueing…" : `Queue ${plan.messages} messages`}</button>
            </div>
            {plan.preview?.text && <Bubble text={plan.preview.text} parts={plan.preview.parts} />}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <h3 className="grow" style={{ margin: 0 }}>Messages</h3>
          <button className="btn" onClick={() => act(() => api("/guardians/jobs/retry/", { body: {} }), (r) => `${r.requeued} failed messages will be tried again.`)}>Retry all failed</button>
          <button className="btn danger" onClick={async () => (await ask({ title: "Stop all waiting messages?", body: "Those children will need a new message (tick “send again”).", yes: "Stop them", danger: true })) && act(() => api("/guardians/jobs/cancel-queued/", { body: {} }), (r) => `${r.cancelled} messages cancelled.`)}>Cancel waiting</button>
        </div>
        <div className="grid3" style={{ marginTop: ".6rem" }}>
          <Stat n={(sj.queued || 0) + (sj.sending || 0)} icon="⏳" label="Waiting" /><Stat n={(sj.sent || 0) + (sj.delivered || 0)} icon="✅" label="Sent" tone="good" /><Stat n={sj.failed || 0} icon="⚠️" label="Failed" tone={sj.failed ? "bad" : undefined} />
        </div>
        <div style={{ marginTop: ".7rem" }}><Dist sent={(sj.sent || 0) + (sj.delivered || 0)} waiting={(sj.queued || 0) + (sj.sending || 0)} failed={sj.failed || 0} /></div>
        <div className="sms-chips" role="group" aria-label="Show messages" style={{ marginTop: ".7rem" }}>
          {FILTERS.map(([k, n]) => <button key={k} type="button" className={`sms-chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{n}{shown(k) !== undefined && <span className="n">{shown(k)}</span>}</button>)}
          {stamp && <span className="sms-stale" role="status">Updated {stamp.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
        </div>
      </div>
      {jobs.loading ? <SkeletonRows /> : jobs.error ? <ErrorNote error={jobs.error} retry={jobs.reload} /> : !jobs.rows.length ? <Empty icon="💬" title={filter ? "Nothing with this status" : "No messages yet"}>{filter ? <div className="row"><button className="btn" onClick={() => setFilter("")}>Show all</button></div> : "Messages you queue above will appear here, and update by themselves while they are sent."}</Empty> : (
        <><div className="tbl-wrap paged" ref={jobs.top} aria-busy={jobs.busy || undefined}><table><thead><tr><th>Parent</th><th>Children</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>
          {jobs.rows.map((j, ix) => (<tr key={j.id} className="sms-row" style={delay(ix)}><td><div className="sms-who"><Avatar name={j.parent} /><div><b>{j.parent}</b><br /><span className="mono small">{j.phone}</span></div></div>{j.old_number && <div className="warn small">⚠ Number changed since. Now {j.current_phone}</div>}</td><td className="small">{j.summary.replace("Login details for ", "") || (j.note ? `“${j.note.slice(0, 60)}${j.note.length > 60 ? "…" : ""}”` : "")}</td>
            <td><Status s={j.status} />{j.error && <div className="no small">{j.error}</div>}{j.attempts > 1 && <div className="muted small">tries: {j.attempts}</div>}</td><td className="small">{when(j.sent_at || j.created_at)}</td>
            <td>{(j.status === "failed" || j.status === "cancelled") && <button className="btn" onClick={() => act(() => api(`/guardians/jobs/${j.id}/retry/`, { body: {} }), () => "Queued again.")}>{j.status === "failed" ? "Retry" : "Send again"}</button>}
              {j.login && j.guardian_id && j.status !== "queued" && j.status !== "sending" && j.status !== "cancelled" && <button className="btn" title="Send new login details to the parent’s current number" onClick={() => setAgain([{ id: j.guardian_id, name: j.parent, phone: j.current_phone }])}>Resend login</button>}</td></tr>))}
        </tbody></table></div>
        <Pager {...jobs.pager} /></>
      )}
      {again && <ResendModal ask={ask} parents={again} onClose={() => setAgain(null)} onDone={(m: string) => { setAgain(null); toast.ok(m); refresh(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------------------------------- Phone */
function Phone({ reload, summary, toast, ask }: { reload: () => void; summary: any } & Tools) {
  const devices = usePaged<any>("/guardians/devices/", {}, { size: 10 });
  const cfg = useLoad(() => api<any>("/guardians/config/"));
  const [name, setName] = useState("School phone"), [made, setMade] = useState<any>(null), [f, setF] = useState<any>(null), [saving, setSaving] = useState(false);
  const { copy, done } = useCopy(toast);
  useEffect(() => { if (cfg.data) setF(cfg.data); }, [cfg.data]);
  useEffect(() => { const i = setInterval(() => { if (!document.hidden) devices.reload(); }, 15000); return () => clearInterval(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!(f && cfg.data && ["public_url", "seconds_between", "pause_every", "pause_seconds"].some((k) => String(f[k]) !== String(cfg.data[k])));
  const sb = Math.max(1, Number(f?.seconds_between) || 8), pe = Math.max(1, Number(f?.pause_every) || 30), ps = Number(f?.pause_seconds) || 0;
  const perHour = Math.round(3600 / (sb + ps / pe));
  const steps: [string, boolean][] = [["Web address saved", !!cfg.data?.public_url], ["A phone is paired", (devices.data?.total ?? devices.rows.length) > 0], ["The phone is online", !!summary.phone_online]];
  const okN = steps.filter((s) => s[1]).length;
  async function save() { setSaving(true); try { await api("/guardians/config/", { method: "PATCH", body: f }); toast.ok("Settings saved."); cfg.reload(); } catch (e: any) { toast.err(e.message); } setSaving(false); }
  return (
    <>
      <div className="card">
        <div className="sms-hero">
          <div className={`sms-radar ${summary.phone_online ? "" : "off"}`} aria-hidden>📱</div>
          <div className="grow">
            <h3 style={{ margin: 0 }}>{summary.phone_online ? "School phone is online" : "School phone is offline"}</h3>
            <p className="muted small" style={{ margin: ".1rem 0 0" }}>{okN === 3 ? "Everything is ready. Messages you queue will go out by themselves." : `${okN} of 3 steps done. Finish the list below to start sending.`}</p>
          </div>
        </div>
        <ul className="sms-check">{steps.map(([n, ok]) => <li key={n} className={ok ? "ok" : ""}><b aria-hidden>{ok ? "✓" : ""}</b>{n}</li>)}</ul>
      </div>
      <div className="card">
        <h3>1. Message settings</h3>
        <p className="muted">The web address goes into every message, so keep it short, for example <b>amani-exams.co.tz</b>.</p>
        {f && (
          <>
            <label className="field"><span>School web address (shown in the text)</span><input className="input" autoCapitalize="none" placeholder="amani-exams.co.tz" value={f.public_url} onChange={(e) => setF({ ...f, public_url: e.target.value })} /></label>
            <div className="grid3">
              <label className="field"><span>Seconds between messages</span><input className="input" type="number" min={3} max={120} value={f.seconds_between} onChange={(e) => setF({ ...f, seconds_between: e.target.value })} /></label>
              <label className="field"><span>Rest after this many</span><input className="input" type="number" min={5} max={100} value={f.pause_every} onChange={(e) => setF({ ...f, pause_every: e.target.value })} /></label>
              <label className="field"><span>Rest for (seconds)</span><input className="input" type="number" min={30} max={1800} value={f.pause_seconds} onChange={(e) => setF({ ...f, pause_seconds: e.target.value })} /></label>
            </div>
            <p className="sms-rate" role="status">⏱ About <b>{perHour}</b> messages an hour. A class of 40 parents takes {fmtDur(40 * sb + Math.floor(40 / pe) * ps)}.</p>
            <p className="muted small">Slow and steady is safest: networks can block a SIM that sends hundreds of texts at once. About 8 seconds apart with a 3-minute rest every 30 messages is a good start.</p>
            <div className="row"><button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button>{dirty && <button className="btn ghost" onClick={() => setF(cfg.data)}>Undo changes</button>}</div>
          </>
        )}
      </div>
      <div className="card">
        <h3>2. Pair the school phone</h3>
        <p className="muted">Install the <b>Amani SMS Sender</b> app on the Android phone that holds the SIM card, then create a pairing code here and type it into the app. A code can be used on one phone, and is shown only once.</p>
        <div className="row"><input className="input grow" aria-label="Phone name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" onClick={async () => { try { setMade(await api("/guardians/devices/", { body: { name } })); devices.reload(); reload(); } catch (e: any) { toast.err(e.message); } }}>Create pairing code</button></div>
      </div>
      {devices.loading ? <SkeletonRows rows={2} /> : devices.error ? <ErrorNote error={devices.error} retry={devices.reload} /> : (
        <><div className="tbl-wrap"><table><thead><tr><th>Phone</th><th>Status</th><th>Last seen</th><th>Messages sent</th><th></th></tr></thead><tbody>
          {!devices.rows.length && <tr><td colSpan={5} className="muted">No phone paired yet.</td></tr>}
          {devices.rows.map((d, ix) => (<tr key={d.id} className="sms-row" style={delay(ix)}><td><b>{d.name}</b></td><td>{d.online ? <span className="pill st-delivered sms-st">● online</span> : <span className="pill st-failed">○ offline</span>}</td><td className="small">{d.last_seen ? when(d.last_seen) : "never"}</td><td><Count n={d.sent} /></td>
            <td><button className="btn danger" onClick={async () => (await ask({ title: `Remove ${d.name}?`, body: "It will stop sending.", yes: "Remove", danger: true })) && api(`/guardians/devices/${d.id}/`, { method: "DELETE" }).then(() => { devices.reload(); reload(); toast.ok("Phone removed."); }).catch((e: any) => toast.err(e.message))}>Remove</button></td></tr>))}
        </tbody></table></div>
        <Pager {...devices.pager} onSize={undefined} /></>
      )}
      {made && (
        <Modal label="Pairing code" onClose={() => setMade(null)}>
          <h2>Pairing code</h2>
          <p className="warn">Copy it now. It is shown only once. Anyone who has it can send messages as the school, so do not share it.</p>
          <label className="field"><span>Server address</span><input className="input mono" readOnly value={apiBase()} onFocus={(e) => e.target.select()} /></label>
          <label className="field"><span>Pairing code</span><input className="input mono" readOnly value={made.token} onFocus={(e) => e.target.select()} /></label>
          <div className="row"><button className="btn" onClick={() => copy("addr", apiBase())}>{done === "addr" ? "Copied ✓" : "Copy address"}</button><button className="btn" onClick={() => copy("code", made.token)}>{done === "code" ? "Copied ✓" : "Copy code"}</button><button className="btn primary grow" onClick={() => setMade(null)}>I have copied it</button></div>
          {apiBase().includes("localhost") && <p className="muted small">This address only works on this computer. For a real phone use the computer’s network address or your real website address.</p>}
        </Modal>
      )}
    </>
  );
}

export default function GuardiansPage() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [tab, setTab] = useState("parents");
  const summary = useLoad(() => api<any>("/guardians/summary/"));
  const classes = useLoad(() => api<any[]>("/classes/"));
  const reload = useCallback(() => summary.reload(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const toast = useToasts(), { ask, node } = useConfirm();
  useEffect(() => { const i = setInterval(() => { if (!document.hidden) summary.reload(); }, 15000); return () => clearInterval(i); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = summary.data, open = s ? (s.jobs.queued || 0) + (s.jobs.sending || 0) : 0;
  const tools: Tools = { toast, ask };
  return (
    <Shell bare title="Parents">
      <div className="sms">
        {!admin ? <p>Only administrators can manage parents.</p> : (summary.loading && !s) || (classes.loading && !classes.data) ? <SkeletonRows rows={4} /> : summary.error && !s ? <ErrorNote error={summary.error} retry={summary.reload} /> : (
          <>
            <div className={`sms-strip ${s!.phone_online ? "on" : "off"}`} role="status">
              <span className="sms-dot" aria-hidden />
              <b>{s!.phone_online ? "School phone online" : "School phone offline"}</b>
              <span className="muted small grow">{open ? `${open} message${open === 1 ? "" : "s"} waiting` : "Nothing waiting"}{s!.jobs.failed ? ` · ${s!.jobs.failed} failed` : ""}</span>
              {open > 0 && tab !== "send" && <button className="btn" onClick={() => setTab("send")}>View progress</button>}
              {!s!.phone_online && tab !== "phone" && <button className="btn" onClick={() => setTab("phone")}>Set up the phone</button>}
            </div>
            <Tabs tabs={[["parents", "Parents"], ["upload", "Upload"], ["send", "Send"], ["phone", "Phone"]]} value={tab} onChange={setTab}
              badges={{ send: open ? { text: open } : s!.jobs.failed ? { text: s!.jobs.failed, warn: true } : undefined, phone: s!.phone_online ? undefined : { text: "!", warn: true } }} />
            <div className="sms-pane" key={tab}>
              {tab === "parents" && <Parents summary={s!} classes={classes.data || []} reload={reload} {...tools} />}
              {tab === "upload" && <Upload reload={reload} goParents={() => setTab("parents")} toast={toast} />}
              {tab === "send" && <Send summary={s!} classes={classes.data || []} reload={reload} {...tools} />}
              {tab === "phone" && <Phone reload={reload} summary={s!} toast={toast} ask={ask} />}
            </div>
          </>
        )}
      </div>
      {toast.node}{node}
    </Shell>
  );
}
