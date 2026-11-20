"use client";
/* Teachers: (1) "find" a colleague's approved question and ask to use it, (2) "requests": answer the requests other teachers sent me and
   follow the ones I sent. A teacher uses only her own questions; this is the only way across (server: questions/shares.py). */
import { CSSProperties, useState } from "react";
import { Pager, usePaged } from "@/components/Pager";
import ShareRequest from "@/components/ShareRequest";
import { ErrorNote, useLoad } from "@/components/ui";
import { api, friendly } from "@/lib/api";
import { plain, qtypeName } from "@/lib/staff";
import "./share.css";

const DIFF: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const STATUS: Record<string, string> = { pending: "Waiting", approved: "Approved", denied: "Denied", revoked: "Withdrawn", cancelled: "Cancelled" };
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Meta({ q }: { q: any }) {
  return (
    <p className="qr-meta">
      <span className="ex2-tag">{qtypeName(q.qtype)}</span>{q.topic && <span className="ex2-tag">{q.topic}</span>}
      <span className="ex2-tag">{DIFF[q.difficulty] || q.difficulty}</span><span className="ex2-tag">Form {q.form_level}</span><span className="ex2-tag">{q.marks} mark{q.marks === 1 ? "" : "s"}</span>
    </p>
  );
}

/** One request, as the owner sees it: approve or deny with an optional reply, or withdraw an approval. */
function Incoming({ r, i, done }: { r: any; i: number; done: () => void }) {
  const [reply, setReply] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  async function act(what: "approve" | "deny" | "revoke") {
    setBusy(what); setErr("");
    try { await api(`/question-shares/${r.id}/${what}/`, { body: { reply: reply.trim() } }); done(); } catch (e) { setErr(friendly(e)); }
    setBusy("");
  }
  return (
    <article className={`qr-card st-${r.status}`} style={{ "--i": i } as CSSProperties}>
      <header><span className="qr-av" aria-hidden>{(r.requester || "?").slice(0, 1).toUpperCase()}</span>
        <div><b>{r.requester}</b><small>{r.subject_name} · {when(r.requested_at)}</small></div><span className={`qr-st st-${r.status}`}>{STATUS[r.status] || r.status}</span></header>
      {r.note && <blockquote>“{r.note}”</blockquote>}
      <p className="qr-text">{plain(r.question.prompt).slice(0, 300) || "(image only)"}</p>
      <Meta q={r.question} />
      {r.status === "pending" && (
        <div className="qr-act">
          <label className="field"><span>Reply (optional)</span><input className="input" maxLength={300} placeholder="e.g. Fine, please credit me in your notes" value={reply} onChange={(e) => setReply(e.target.value)} /></label>
          <div className="qr-btns"><button type="button" className="btn primary" disabled={!!busy} onClick={() => act("approve")}>{busy === "approve" ? "…" : "✓ Approve"}</button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => act("deny")}>{busy === "deny" ? "…" : "✕ Deny"}</button></div>
        </div>
      )}
      {r.status === "approved" && <div className="qr-btns"><button type="button" className="btn" disabled={!!busy} onClick={() => act("revoke")}>{busy === "revoke" ? "…" : "Withdraw permission"}</button></div>}
      {(r.status === "denied" || r.status === "revoked") && <div className="qr-btns"><button type="button" className="btn" disabled={!!busy} onClick={() => act("approve")}>{busy ? "…" : "Approve after all"}</button></div>}
      {r.reply && r.status !== "pending" && <p className="qr-reply small muted">Your reply: “{r.reply}”</p>}
      {err && <p className="no small" role="alert">⚠ {err}</p>}
    </article>
  );
}

function Outgoing({ r, i, done }: { r: any; i: number; done: () => void }) {
  return (
    <article className={`qr-card st-${r.status}`} style={{ "--i": i } as CSSProperties}>
      <header><span className="qr-av" aria-hidden>{(r.owner || "?").slice(0, 1).toUpperCase()}</span>
        <div><b>{r.owner}</b><small>{r.subject_name} · asked {when(r.requested_at)}</small></div><span className={`qr-st st-${r.status}`}>{STATUS[r.status] || r.status}</span></header>
      <p className="qr-text">{plain(r.question.prompt).slice(0, 300) || "(image only)"}</p>
      <Meta q={r.question} />
      {r.reply && <p className="qr-reply small">Reply from {r.owner}: “{r.reply}”</p>}
      {r.status !== "cancelled" && <ShareRequest qid={r.question.id} owner={r.owner} share={{ status: r.status, id: r.id, reply: r.reply, owner: r.owner }} onChange={done} />}
      {r.status === "approved" && <p className="small muted">You can add it to your exams from the exam builder, under “Shared with me”.</p>}
    </article>
  );
}

export default function QuestionRequests({ mode, onChanged }: { mode: "find" | "requests"; onChanged?: () => void }) {
  return mode === "find" ? <Find onChanged={onChanged} /> : <Requests onChanged={onChanged} />;
}

function Requests({ onChanged }: { onChanged?: () => void }) {
  const [box, setBox] = useState<"incoming" | "outgoing">("incoming"), [status, setStatus] = useState("");
  const list = usePaged<any>("/question-shares/", { box, status }, { size: 8 });
  const done = () => { list.reload(); onChanged?.(); };
  return (
    <div className="qr">
      <div className="qr-seg" role="group" aria-label="Which requests">
        <button type="button" className={box === "incoming" ? "on" : ""} aria-pressed={box === "incoming"} onClick={() => { setBox("incoming"); setStatus(""); }}>📥 To answer</button>
        <button type="button" className={box === "outgoing" ? "on" : ""} aria-pressed={box === "outgoing"} onClick={() => { setBox("outgoing"); setStatus(""); }}>📤 I asked</button>
      </div>
      <div className="ex2-chips" role="group" aria-label="Status">
        {[["", "All"], ["pending", "Waiting"], ["approved", "Approved"], ["denied", "Denied"]].map(([k, l]) => (
          <button key={k || "all"} type="button" className={`ex2-chip ${status === k ? "on" : ""}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>))}
      </div>
      {list.error ? <ErrorNote error={list.error} retry={list.reload} /> : list.loading ? <div className="qr-skels" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="qr-skel" />)}</div>
        : !list.rows.length ? (
          <div className="card ex2-empty"><span aria-hidden>{box === "incoming" ? "📭" : "📨"}</span><h3>{box === "incoming" ? "No requests to answer" : "You have not asked for any questions"}</h3>
            <p className="muted">{box === "incoming" ? "When another teacher asks to use one of your questions, it shows here and you get a notification." : "Use “Find questions” to ask a colleague for a question, or the “Ask other teachers” tab in an exam."}</p></div>
        ) : (
          <>
            <div className="qr-list" ref={list.top} aria-busy={list.busy || undefined}>
              {list.rows.map((r, i) => box === "incoming" ? <Incoming key={r.id} r={r} i={i} done={done} /> : <Outgoing key={r.id} r={r} i={i} done={done} />)}
            </div>
            <Pager {...list.pager} />
          </>
        )}
    </div>
  );
}

function Find({ onChanged }: { onChanged?: () => void }) {
  const [f, setF] = useState({ q: "", subject: "", difficulty: "", state: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const meta = useLoad(() => api<any>("/question-shares/browse/?page=1&page_size=1"));
  const list = usePaged<any>("/question-shares/browse/", f, { size: 8 });
  return (
    <div className="qr">
      <p className="qr-info">📨 You use your own questions. Here are the approved questions of other teachers in your subjects. Ask the owner, and once they approve you can add it to your exams (answers stay hidden until then).</p>
      <div className="card qr-filters">
        <input className="input" type="search" placeholder="Search question text or topic" aria-label="Search questions" value={f.q} onChange={(e) => set("q", e.target.value)} />
        <select className="input" aria-label="Subject" value={f.subject} onChange={(e) => set("subject", e.target.value)}><option value="">All my subjects</option>{(meta.data?.subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="input" aria-label="Difficulty" value={f.difficulty} onChange={(e) => set("difficulty", e.target.value)}><option value="">Any difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
        <select className="input" aria-label="My request" value={f.state} onChange={(e) => set("state", e.target.value)}><option value="">Any request state</option><option value="none">Not asked yet</option><option value="pending">Waiting</option><option value="approved">Approved</option><option value="denied">Denied</option></select>
      </div>
      {list.error ? <ErrorNote error={list.error} retry={list.reload} /> : list.loading ? <div className="qr-skels" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="qr-skel" />)}</div>
        : !list.rows.length ? (
          <div className="card ex2-empty"><span aria-hidden>🔍</span><h3>No questions to show</h3><p className="muted">No other teacher has an approved question matching this yet. Try clearing the filters.</p></div>
        ) : (
          <>
            <p className="muted small" role="status">{list.count} question{list.count === 1 ? "" : "s"} from other teachers</p>
            <div className="qr-list" ref={list.top} aria-busy={list.busy || undefined}>
              {list.rows.map((q, i) => (
                <article key={q.id} className="qr-card" style={{ "--i": i } as CSSProperties}>
                  <header><span className="qr-av" aria-hidden>{(q.created_by_name || "?").slice(0, 1).toUpperCase()}</span><div><b>{q.created_by_name || "A colleague"}</b><small>{(meta.data?.subjects || []).find((s: any) => s.id === q.subject)?.name || ""}</small></div></header>
                  <p className="qr-text">{plain(q.prompt).slice(0, 300) || "(image only)"}</p>
                  <Meta q={q} />
                  <ShareRequest qid={q.id} owner={q.created_by_name || "the teacher"} share={q.share} onChange={() => { list.reload(); onChanged?.(); }} />
                </article>))}
            </div>
            <Pager {...list.pager} />
          </>
        )}
    </div>
  );
}
