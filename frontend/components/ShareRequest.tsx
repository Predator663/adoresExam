"use client";
/* "Request to use" for another teacher's question. A teacher uses only her own questions; this asks the owner, who approves or denies
   (server: questions/shares.py). It shows the state of THIS teacher's request and lets her send, cancel or ask again. */
import { useState } from "react";
import { api, friendly } from "@/lib/api";
import "./share.css";

export type Share = { status: string; id: number; reply?: string; owner?: string } | null | undefined;

export default function ShareRequest({ qid, owner, share, onChange }: { qid: number; owner: string; share: Share; onChange: (s: Share) => void }) {
  const [open, setOpen] = useState(false), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const st = share?.status;
  const who = owner || share?.owner || "the owner";

  async function send() {
    setBusy(true); setErr("");
    try {
      const r = await api<any>("/question-shares/", { body: { question: qid, note: note.trim() } });
      onChange({ status: "pending", id: r.id, owner: who });
      setOpen(false); setNote("");
    } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }
  async function cancel() {
    if (!share) return;
    setBusy(true); setErr("");
    try { await api(`/question-shares/${share.id}/cancel/`, { body: {} }); onChange(null); } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  }

  if (st === "approved") return <span className="shr ok" role="status">✓ Approved by {who}</span>;
  if (st === "pending") return (
    <div className="shr-box"><span className="shr wait" role="status"><i aria-hidden />Waiting for {who}</span>
      <button type="button" className="linkbtn" disabled={busy} onClick={cancel}>Cancel request</button>{err && <p className="no small" role="alert">⚠ {err}</p>}</div>
  );
  return (
    <div className="shr-box">
      {(st === "denied" || st === "revoked") && <span className="shr no" role="status">✕ {st === "denied" ? "Denied" : "Permission withdrawn"} by {who}{share?.reply ? `: “${share.reply}”` : ""}</span>}
      {!open ? (
        <button type="button" className="btn primary shr-ask" onClick={() => setOpen(true)}>{st === "denied" || st === "revoked" ? "Ask again" : "Request to use"}</button>
      ) : (
        <div className="shr-form">
          <label className="field"><span>Message to {who} (optional)</span>
            <textarea className="input" rows={2} maxLength={300} placeholder="e.g. For the Form 2 mid-term test" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></label>
          <div className="shr-acts"><button type="button" className="btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send request"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { setOpen(false); setErr(""); }}>Cancel</button></div>
          {err && <p className="no small" role="alert">⚠ {err}</p>}
        </div>
      )}
    </div>
  );
}
