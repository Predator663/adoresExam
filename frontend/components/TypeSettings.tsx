"use client";
import type { S } from "./QuestionEditor";

/** Settings a teacher can choose for a matching question and for a fill-in-the-blank question.
 *  Used by the single-question editor and by "Create all". Every default keeps the question working as before. */
type Up = (p: Partial<S>) => void;

export function MatchSettings({ s, up }: { s: S; up: Up }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Layout and marking</h3>
      <div className="grid2">
        <label className="field"><span>Title of Column A</span><input className="input" maxLength={60} placeholder="Column A" value={s.mLeftTitle || ""} onChange={(e) => up({ mLeftTitle: e.target.value })} /></label>
        <label className="field"><span>Title of Column B</span><input className="input" maxLength={60} placeholder="Column B" value={s.mRightTitle || ""} onChange={(e) => up({ mRightTitle: e.target.value })} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Numbering of Column A</span>
          <select className="input" value={s.mLeftStyle || "roman"} onChange={(e) => up({ mLeftStyle: e.target.value as S["mLeftStyle"] })}>
            <option value="roman">(i) (ii) (iii)</option><option value="ROMAN">(I) (II) (III)</option><option value="number">(1) (2) (3)</option></select></label>
        <label className="field"><span>Labels of Column B</span>
          <select className="input" value={s.mRightStyle || "LETTER"} onChange={(e) => up({ mRightStyle: e.target.value as S["mRightStyle"] })}>
            <option value="LETTER">A B C</option><option value="letter">a b c</option><option value="number">1 2 3</option></select></label>
      </div>
      <label className="switch"><input type="checkbox" checked={s.mShuffle !== false} onChange={(e) => up({ mShuffle: e.target.checked })} /> Shuffle Column B for each student</label>
      <p className="muted small" style={{ margin: ".1rem 0 .6rem" }}>Switch off to keep Column B in the order you wrote it (so the letters are the same for everyone).</p>
      <label className="switch"><input type="checkbox" checked={!!s.mUnique} onChange={(e) => up({ mUnique: e.target.checked })} /> Each Column B item can be used once only</label>
      <label className="field" style={{ marginTop: ".6rem" }}><span>Marks for this question</span>
        <select className="input" value={s.mPartial || ""} onChange={(e) => up({ mPartial: e.target.value as S["mPartial"] })}>
          <option value="">Follow the exam's setting</option>
          <option value="all">All or nothing: every pair must be right</option>
          <option value="per_pair">Partial marks: a share of the marks for each correct pair</option></select></label>
      <p className="muted small">Extra items in Column B that match nothing are allowed, and make the question harder.</p>
    </div>
  );
}

export function FillSettings({ s, up }: { s: S; up: Up }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Answer box and marking</h3>
      <label className="switch"><input type="checkbox" checked={!!s.fCase} onChange={(e) => up({ fCase: e.target.checked })} /> Capital letters must match (HTML is not html)</label>
      <label className="switch" style={{ marginTop: ".3rem" }}><input type="checkbox" checked={!!s.fPunct} onChange={(e) => up({ fPunct: e.target.checked })} /> Ignore punctuation (e-mail is accepted as email)</label>
      <p className="muted small" style={{ margin: ".2rem 0 .6rem" }}>Extra spaces are always ignored.</p>
      <div className="grid2">
        <label className="field"><span>Unit shown after the box (optional)</span><input className="input" maxLength={20} placeholder="cm, kg, %" value={s.fUnit || ""} onChange={(e) => up({ fUnit: e.target.value })} /></label>
        <label className="field"><span>Hint under the box (optional)</span><input className="input" maxLength={120} placeholder="Write one word" value={s.fHint || ""} onChange={(e) => up({ fHint: e.target.value })} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Phone keyboard</span>
          <select className="input" value={s.fInput || "text"} onChange={(e) => up({ fInput: e.target.value as S["fInput"] })}><option value="text">Letters</option><option value="number">Numbers</option></select></label>
        <label className="field"><span>Size of the box</span>
          <select className="input" value={s.fWidth || "medium"} onChange={(e) => up({ fWidth: e.target.value as S["fWidth"] })}><option value="short">Short (a word or number)</option><option value="medium">Medium</option><option value="long">Long (a phrase)</option></select></label>
      </div>
    </div>
  );
}
