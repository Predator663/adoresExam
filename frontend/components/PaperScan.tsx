"use client";
/* Admin: a printed home package came back. Scan its barcode (a USB scanner types the code, or use the phone's camera), or type the code.
   The student is recognised and her sheet is marked RECEIVED (she counts as submitted). The same screen opens her answers to be keyed in;
   they are auto-marked like any online exam. Server: exams/paper.py. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, friendly } from "@/lib/api";
import { itemText, key } from "@/lib/paper";
import type { PaperQuestion, ScanData } from "@/lib/paper";
import { leftMark, matchLayout, rightTag } from "@/lib/labels";
import { plain } from "@/lib/staff";
import "./paper.css";

type Val = any;

/** What the screen holds for a question -> what the server wants. `null` = left empty; a string = something is half done. */
function toResponse(q: PaperQuestion, v: Val): { value: any; problem?: string } {
  const empty = { value: null };
  if (q.type === "mcq_single") return v ? { value: v } : empty;
  if (q.type === "mcq_multi") return Array.isArray(v) && v.length ? { value: v } : empty;
  if (q.type === "true_false") return typeof v === "boolean" ? { value: v } : empty;
  if (q.type === "fill_blank") return typeof v === "string" && v.trim() ? { value: v.trim() } : empty;
  if (q.type === "matching") { const o = Object.fromEntries(Object.entries(v || {}).filter(([, x]) => x)); return Object.keys(o).length ? { value: o } : empty; }
  if (q.type === "fill_multi") { const o = Object.fromEntries(Object.entries(v || {}).filter(([, x]) => String(x).trim())); return Object.keys(o).length ? { value: o } : empty; }
  if (q.type === "ordering") {
    const n = (q.content?.items || []).length, a: string[] = Array.isArray(v) ? v : [], filled = a.filter(Boolean).length;
    if (!filled) return empty;
    return filled === n && a.length === n ? { value: a } : { value: null, problem: `Question ${q.number}: put every item in order, or clear them all.` };
  }
  return empty;
}

function Keys({ q, v, set }: { q: PaperQuestion; v: Val; set: (x: Val) => void }) {
  const c = q.content || {};
  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    const multi = q.type === "mcq_multi", cur: string[] = multi ? (Array.isArray(v) ? v : []) : [];
    return (
      <div className="pe-keys" role={multi ? "group" : "radiogroup"} aria-label={multi ? "Choose all that were marked" : "Choose the one marked"}>
        {(c.options || []).map((o: any, i: number) => {
          const on = multi ? cur.includes(o.id) : v === o.id;
          return (
            <button key={o.id} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} className={`pe-key ${on ? "on" : ""} ${multi ? "sq" : ""}`}
              onClick={() => set(multi ? (on ? cur.filter((x) => x !== o.id) : [...cur, o.id]) : on ? undefined : o.id)}>
              {key(i)}<small>{itemText(o)}</small>
            </button>
          );
        })}
      </div>
    );
  }
  if (q.type === "true_false") {
    return (
      <div className="pe-keys" role="radiogroup" aria-label="True or false">
        {[true, false].map((b) => <button key={String(b)} type="button" role="radio" aria-checked={v === b} className={`pe-key ${v === b ? "on" : ""}`} onClick={() => set(v === b ? undefined : b)}>{b ? "True" : "False"}</button>)}
      </div>
    );
  }
  if (q.type === "fill_blank") {
    return <div className="pe-line"><input className="input" value={typeof v === "string" ? v : ""} onChange={(e) => set(e.target.value)} placeholder="What she wrote" aria-label={`Answer to question ${q.number}`} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode={c.input === "number" ? "decimal" : "text"} />{c.unit ? <span>{c.unit}</span> : null}</div>;
  }
  if (q.type === "matching") {
    const lay = matchLayout(c), cur: Record<string, string> = v || {};
    return (
      <div className="hp-list">
        {(c.left || []).map((l: any, i: number) => (
          <div key={l.id} className="pe-line">
            <span>{leftMark(lay.left_style, i)}</span><span className="small" style={{ flex: 1, minWidth: 0 }}>{itemText(l)}</span>
            <select className="input" style={{ flex: "none", width: "6.5rem" }} value={cur[l.id] || ""} aria-label={`${leftMark(lay.left_style, i)} matches`} onChange={(e) => set({ ...cur, [l.id]: e.target.value })}>
              <option value="">—</option>
              {(c.right || []).map((r: any, j: number) => <option key={r.id} value={r.id}>{rightTag(lay.right_style, j)}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  }
  if (q.type === "ordering") {
    const items: any[] = c.items || [], cur: string[] = Array.isArray(v) ? v : [];
    const at = (p: number) => cur[p] || "";
    const put = (p: number, id: string) => { const a = Array.from({ length: items.length }, (_, k) => cur[k] || ""); a[p] = id; set(a); };
    return (
      <div className="hp-list">
        {items.map((_, p) => (
          <div key={p} className="pe-line">
            <span>{p + 1}.</span>
            <select className="input" value={at(p)} aria-label={`Position ${p + 1}`} onChange={(e) => put(p, e.target.value)}>
              <option value="">—</option>
              {items.map((it, i) => <option key={it.id} value={it.id} disabled={cur.includes(it.id) && at(p) !== it.id}>{key(i)}. {itemText(it)}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  }
  if (q.type === "fill_multi") {
    const cur: Record<string, string> = v || {}, bank = c.mode === "bank";
    return (
      <div className="hp-list">
        {(c.blanks || []).map((b: any, i: number) => (
          <div key={b.id} className="pe-line">
            <span>({i + 1})</span>
            {bank ? (
              <select className="input" value={cur[b.id] || ""} aria-label={`Blank ${i + 1}`} onChange={(e) => set({ ...cur, [b.id]: e.target.value })}>
                <option value="">—</option>
                {(c.bank || []).map((w: any, j: number) => <option key={w.id} value={w.id}>{key(j)}. {w.text}</option>)}
              </select>
            ) : (
              <input className="input" value={cur[b.id] || ""} aria-label={`Blank ${i + 1}`} onChange={(e) => set({ ...cur, [b.id]: e.target.value })} autoComplete="off" autoCapitalize="off" spellCheck={false} />
            )}
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export default function PaperScan() {
  const [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [data, setData] = useState<ScanData | null>(null), [vals, setVals] = useState<Record<number, Val>>({});
  const [saved, setSaved] = useState<{ result: { score: number; total: number; percent: number; grade: string; passed: boolean }; answered: number; questions: number; redo: boolean } | null>(null);
  const [recent, setRecent] = useState<{ name: string; code: string; percent: number }[]>([]);
  const [canCam, setCanCam] = useState(false), [cam, setCam] = useState(false), [camErr, setCamErr] = useState("");
  const input = useRef<HTMLInputElement>(null), video = useRef<HTMLVideoElement>(null);

  useEffect(() => { setCanCam(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia); input.current?.focus(); }, []);

  const lookup = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c || busy) return;
    setBusy(true); setErr(""); setSaved(null);
    try {
      const d = await api<ScanData>("/paper/scan/", { body: { code: c } });
      const v: Record<number, Val> = {};
      d.questions.forEach((q) => { const a = d.answers[String(q.id)]; if (a !== undefined && a !== null) v[q.id] = a; });
      setData(d); setVals(v); setCode("");
      window.scrollTo({ top: 0 });
    } catch (e: any) { setErr(friendly(e)); input.current?.select(); }
    setBusy(false);
  }, [busy]);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  // Phone camera (Chrome on Android and desktop Chrome can read Code 128 by themselves; iPhones type the code instead)
  useEffect(() => {
    if (!cam) return;
    let stop = false, stream: MediaStream | null = null, timer: any;
    (async () => {
      try {
        const Det = (window as any).BarcodeDetector, det = new Det({ formats: ["code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const tick = async () => {
          if (stop) return;
          try {
            const found = video.current ? await det.detect(video.current) : [];
            if (found.length) { stop = true; setCam(false); lookupRef.current(found[0].rawValue); return; }
          } catch { /* a frame that could not be read: try the next */ }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch { setCamErr("The camera could not be opened. Allow camera access, or type the code."); setCam(false); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [cam]);

  const set = (q: PaperQuestion, v: Val) => { setVals({ ...vals, [q.id]: v }); setSaved(null); };
  const state = (data?.questions || []).map((q) => ({ q, r: toResponse(q, vals[q.id]) }));
  const answered = state.filter((s) => s.r.value !== null).length, problems = state.filter((s) => s.r.problem).map((s) => s.r.problem as string);

  async function save() {
    if (!data) return;
    if (problems.length) { setErr(problems.join(" ")); return; }
    const left = state.length - answered;
    if (left && !window.confirm(`${left} ${left === 1 ? "question has" : "questions have"} no answer. Save anyway?`)) return;
    setBusy(true); setErr("");
    try {
      const answers: Record<string, any> = {};
      state.forEach(({ q, r }) => { if (r.value !== null) answers[String(q.id)] = r.value; });
      const r = await api<NonNullable<typeof saved>>("/paper/answers/", { body: { code: data.sheet.code, answers } });
      setSaved(r);
      setRecent((x) => [{ name: data.student.name, code: data.sheet.pretty, percent: r.result.percent }, ...x.filter((y) => y.code !== data.sheet.pretty)].slice(0, 8));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) { setErr(friendly(e)); }
    setBusy(false);
  }

  function next() { setData(null); setSaved(null); setVals({}); setErr(""); setTimeout(() => input.current?.focus(), 50); }

  if (!data) {
    return (
      <div className="pe">
        <div className="card pe-scan">
          <h2>Scan a returned home package</h2>
          <p className="muted">Scan the barcode on the answer sheet with a USB scanner (click in the box first), or type the code printed under it.</p>
          <form onSubmit={(e) => { e.preventDefault(); lookup(code); }} className="pe-scan">
            <input ref={input} className="input pe-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" aria-label="Sheet code" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            <button type="submit" className="btn primary" disabled={!code.trim() || busy}>{busy ? "Looking…" : "Find the student"}</button>
            {canCam && !cam && <button type="button" className="btn" onClick={() => { setCamErr(""); setCam(true); }}>📷 Scan with the camera</button>}
          </form>
          {cam && (
            <>
              <video ref={video} className="pe-cam" muted playsInline aria-label="Camera: point it at the barcode" />
              <button type="button" className="btn" onClick={() => setCam(false)}>Stop the camera</button>
            </>
          )}
          {camErr && <p className="no" role="alert">⚠ {camErr}</p>}
          {!canCam && <p className="muted small">This browser cannot read barcodes with the camera. Use a USB scanner, or type the code.</p>}
          {err && <p className="no" role="alert">⚠ {err}</p>}
        </div>
        {!!recent.length && (
          <div className="card"><h3>Done in this session</h3>
            <ul className="pe-recent">{recent.map((r) => <li key={r.code}><span>{r.name}</span><b>{r.percent}%</b></li>)}</ul></div>
        )}
      </div>
    );
  }

  const r = saved?.result || data.result;
  return (
    <div className="pe">
      <div className="pe-who">
        <div style={{ flex: 1, minWidth: "12rem" }}>
          <h2>{data.student.name}</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.student.class || "-"}{data.student.index ? ` · ${data.student.index}` : ""} · {data.exam.title}</p>
          <p className="small" style={{ margin: ".2rem 0 0" }}>
            {data.sheet.already_scanned ? <span className="pe-warn">⚠ This sheet was already scanned before. </span> : <span className="pe-ok">✓ Received. </span>}
            <span className="pe-mono" style={{ fontFamily: "monospace" }}>{data.sheet.pretty}</span>
          </p>
        </div>
        <button type="button" className="btn" onClick={next}>Not this one</button>
      </div>

      {saved && (
        <div className="pe-result" role="status">
          <span className="muted">{saved.redo ? "Re-marked" : "Marked"} · answered {saved.answered} of {saved.questions}</span>
          <span className="pe-big">{r!.score} / {r!.total}</span>
          <b>{r!.percent}% · Grade {r!.grade} · {r!.passed ? <span className="pe-ok">Pass</span> : <span className="pe-warn">Below the pass mark</span>}</b>
          <button type="button" className="btn primary" onClick={next}>Scan the next sheet</button>
        </div>
      )}

      {!saved && data.result && <p className="muted" role="status">Answers were keyed in before: {data.result.score}/{data.result.total} ({data.result.percent}%). Change anything that was wrong and save again to re-mark.</p>}

      {data.sections.map((sec) => (
        <section key={sec.letter} className="hp-list" aria-label={`Section ${sec.letter}`}>
          <h3 style={{ margin: ".4rem 0 0" }}>Section {sec.letter}: {sec.title}</h3>
          {data.questions.filter((q) => q.section === sec.letter).map((q) => {
            const r2 = toResponse(q, vals[q.id]);
            return (
              <div key={q.id} className={`pe-q ${r2.value === null ? "empty" : ""}`}>
                <div className="pe-qh"><span className="pe-qn">{q.number}</span><span className="pe-qt">{plain(q.type === "fill_multi" ? q.prompt.replace(/\[\[(\d+)\]\]/g, "($1)___") : q.prompt).slice(0, 160)}<span className="muted small"> [{q.marks}]</span></span></div>
                <Keys q={q} v={vals[q.id]} set={(x) => set(q, x)} />
              </div>
            );
          })}
        </section>
      ))}

      {err && <p className="no" role="alert">⚠ {err}</p>}
      <div className="pe-summary">
        <span className="grow">{answered} of {state.length} answered</span>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : saved || data.result ? "Save and re-mark" : "Save and mark"}</button>
      </div>
    </div>
  );
}
