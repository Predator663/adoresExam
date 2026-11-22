"use client";
/* The printed home package of each chosen student: a cover (her name, class, unique code and barcode), the questions (the same for everyone,
   no answers), and her answer sheet (name, code and barcode again, so the sheet that comes back can be scanned). Server: exams/paper.py.
   Always black on white, whatever theme the app has: it is meant for paper. */
import type { ReactNode } from "react";
import Barcode from "@/components/Barcode";
import { eatDate } from "@/lib/clock";
import { leftMark, matchLayout, rightMark } from "@/lib/labels";
import { key, withImages } from "@/lib/paper";
import type { PackData, PackStudent, PaperQuestion } from "@/lib/paper";
import { mediaUrl } from "@/lib/api";
import "./paper.css";

const when = (iso: string | null) => (iso ? eatDate(iso, { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const Html = ({ html, className }: { html: string; className?: string }) => <div className={`pp-html ${className || ""}`} dangerouslySetInnerHTML={{ __html: withImages(html) }} />;
const Item = ({ it }: { it: { text?: string; image?: string | null; alt_text?: string } }) => (
  <span className="pp-item">{it.image && <img src={mediaUrl(it.image)} alt={it.alt_text || ""} className="pp-thumb" />}{it.text ? <span dangerouslySetInnerHTML={{ __html: withImages(it.text) }} /> : null}</span>
);
const Box = ({ n = 1, round }: { n?: number; round?: boolean }) => <>{Array.from({ length: n }, (_, i) => <span key={i} className={`pp-box ${round ? "round" : ""}`} />)}</>;

/** The question as printed (no answers). */
function PrintQuestion({ q }: { q: PaperQuestion }) {
  const c = q.content || {};
  const prompt = q.type === "fill_multi" ? (q.prompt || "").replace(/\[\[(\d+)\]\]/g, "<b>($1)</b> ________") : q.prompt;
  return (
    <div className="pp-q">
      <div className="pp-qn">{q.number}.</div>
      <div className="pp-qb">
        <Html html={prompt} />
        <span className="pp-marks">[{q.marks} {q.marks === 1 ? "mark" : "marks"}]</span>
        {(q.type === "mcq_single" || q.type === "mcq_multi") && (
          <ol className="pp-opts">{(c.options || []).map((o: any, i: number) => <li key={o.id}><b>{key(i)}.</b> <Item it={o} /></li>)}</ol>
        )}
        {q.type === "matching" && (() => {
          const lay = matchLayout(c);
          return (
            <div className="pp-match">
              <div><h5>{lay.left_title || "Column A"}</h5>{(c.left || []).map((l: any, i: number) => <p key={l.id}><b>{leftMark(lay.left_style, i)}</b> <Item it={l} /></p>)}</div>
              <div><h5>{lay.right_title || "Column B"}</h5>{(c.right || []).map((r: any, j: number) => <p key={r.id}><b>{rightMark(lay.right_style, j)}</b> <Item it={r} /></p>)}</div>
            </div>
          );
        })()}
        {q.type === "ordering" && (
          <>
            <ol className="pp-opts">{(c.items || []).map((it: any, i: number) => <li key={it.id}><b>{key(i)}.</b> <Item it={it} /></li>)}</ol>
            <p className="pp-note">Write the letters in the correct order on the answer sheet.</p>
          </>
        )}
        {q.type === "fill_multi" && c.mode === "bank" && (
          <p className="pp-bank"><b>Word bank:</b> {(c.bank || []).map((w: any, i: number) => <span key={w.id}><b>{key(i)}.</b> {w.text}</span>)}</p>
        )}
        {q.type === "fill_blank" && c.unit ? <p className="pp-note">Give your answer in {c.unit}.</p> : null}
      </div>
    </div>
  );
}

/** How the student writes this answer on the answer sheet. */
function AnswerRow({ q }: { q: PaperQuestion }) {
  const c = q.content || {};
  let body: ReactNode;
  if (q.type === "mcq_single") body = (c.options || []).map((_: any, i: number) => <span key={i} className="pp-bub">{key(i)}</span>);
  else if (q.type === "mcq_multi") body = (c.options || []).map((_: any, i: number) => <span key={i} className="pp-bub sq">{key(i)}</span>);
  else if (q.type === "true_false") body = <><span className="pp-bub wide">True</span><span className="pp-bub wide">False</span></>;
  else if (q.type === "matching") {
    const lay = matchLayout(c);
    body = (c.left || []).map((_: any, i: number) => <span key={i} className="pp-pair"><b>{leftMark(lay.left_style, i)}</b><Box /></span>);
  } else if (q.type === "ordering") body = <><span className="pp-note">in order:</span><Box n={(c.items || []).length} /></>;
  else if (q.type === "fill_multi") {
    const bank = c.mode === "bank";
    body = (c.blanks || []).map((b: any, i: number) => <span key={b.id} className="pp-pair"><b>({i + 1})</b>{bank ? <Box /> : <span className="pp-line short" />}</span>);
  } else body = <span className="pp-line" />;
  return <div className="pp-ar"><span className="pp-arn">{q.number}</span><span className="pp-arb">{body}</span></div>;
}

function Pack({ data, s }: { data: PackData; s: PackStudent }) {
  const { exam, school, sections, questions } = data;
  const code = s.sheet?.code || "", pretty = s.sheet?.pretty || "";
  const ident = (
    <div className="pp-ident">
      <div><span className="pp-lab">Name</span><b className="pp-name">{s.name}</b></div>
      <div><span className="pp-lab">Class</span><b>{s.class || "-"}</b></div>
      <div><span className="pp-lab">Index no.</span><b>{s.index || "-"}</b></div>
    </div>
  );
  const codeBlock = (
    <div className="pp-codeblock">
      <div className="pp-bar"><Barcode value={code} height={64} /></div>
      <div className="pp-code" aria-label="Your code">{pretty}</div>
    </div>
  );
  return (
    <table className="pp-pack">
      <thead><tr><th><div className="pp-run"><span>{school.name} · {exam.title}</span><span>{s.name} · {s.class}</span><span className="pp-mono">{pretty}</span></div></th></tr></thead>
      <tbody><tr><td>
        {/* ---- cover */}
        <section className="pp-cover">
          <div className="pp-brand">{school.logo && <img src={school.logo} alt="" className="pp-logo" />}<div><h1>{school.name}</h1><p>HOME EXAM PACKAGE</p></div></div>
          <h2 className="pp-title">{exam.title}</h2>
          <p className="pp-sub">{exam.subject} · {questions.length} questions · {exam.total_marks} marks · {exam.duration_minutes} minutes</p>
          {ident}
          {codeBlock}
          <div className="pp-how">
            <h3>Instructions</h3>
            <ol>
              <li>This package is yours alone. The code and barcode above belong to you; do not share them or lend this package.</li>
              <li>Read the questions on the question pages. Write ALL your answers on the <b>answer sheet</b> (the last page), with a blue or black pen.</li>
              <li>For choices, fill the circle or box of the letter you choose. For other questions, write clearly in the space.</li>
              <li>Write your answers yourself. Hand in the whole package{exam.end_at ? <> by <b>{when(exam.end_at)}</b></> : null}. Keep it clean: the answer sheet is scanned by its barcode.</li>
            </ol>
            {exam.rules_text && <p className="pp-rules">{exam.rules_text}</p>}
          </div>
        </section>

        {/* ---- the questions */}
        <section className="pp-questions">
          {sections.map((sec) => (
            <div key={sec.letter} className="pp-sec">
              <h3 className="pp-sech">Section {sec.letter}: {sec.title}</h3>
              <p className="pp-note">{sec.instructions}</p>
              {questions.filter((q) => q.section === sec.letter).map((q) => <PrintQuestion key={q.id} q={q} />)}
            </div>
          ))}
        </section>

        {/* ---- the answer sheet */}
        <section className="pp-sheet">
          <div className="pp-sheeth">
            <div><h2>ANSWER SHEET</h2><p className="pp-sub">{exam.title} · {exam.subject}</p>{ident}</div>
            {codeBlock}
          </div>
          {sections.map((sec) => (
            <div key={sec.letter} className="pp-sec">
              <h3 className="pp-sech">Section {sec.letter}: {sec.title}</h3>
              {questions.filter((q) => q.section === sec.letter).map((q) => <AnswerRow key={q.id} q={q} />)}
            </div>
          ))}
          <p className="pp-end">— End of the answer sheet —</p>
        </section>
      </td></tr></tbody>
    </table>
  );
}

export default function PaperPrint({ data, students }: { data: PackData; students: PackStudent[] }) {
  return <div className="pp-all">{students.filter((s) => s.sheet).map((s) => <Pack key={s.id} data={data} s={s} />)}</div>;
}
