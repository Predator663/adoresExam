"use client";
/* Matching pairs with a colour for each pair: green = right, orange = right but the question is only partly right, red = wrong.
   Used by the Full exam tab (ExamReview) and by the question-by-question review (/review/). */
import { ItemContent } from "@/components/Rich";
import { leftMark, matchLayout, rightTag } from "@/lib/labels";
import { pairPart, pairsOf, type Part, type RQ } from "@/lib/review";
import { useSession } from "@/lib/session";
import "./exam-review.css";

/** ✓ right, a half-filled circle = right but only partly correct, ✗ wrong. (Drawn, because the ◐ character is tiny or missing on many phones.) */
export function PartIcon({ part }: { part: Part }) {
  if (part === "mid") return <i className="rv-half" />;
  return <>{part === "ok" || part === "miss" ? "✓" : part === "bad" ? "✗" : ""}</>;
}

export function MatchPairs({ q }: { q: RQ }) {
  const { t } = useSession();
  const c = q.content || {}, lay = matchLayout(c), mine = pairsOf(q.your_response), key = pairsOf(q.correct_answer);
  const right = (id?: string) => {
    const j = (c.right || []).findIndex((x: any) => x.id === id);
    if (j < 0) return null;
    return <>{!lay.shuffle_right && <b>{rightTag(lay.right_style, j)}. </b>}<ItemContent item={c.right[j]} /></>;
  };
  return (
    <div className="rv-pairs">
      {(c.left || []).map((l: any, i: number) => {
        const part = pairPart(q, l.id), got = mine[l.id];
        return (
          <div key={l.id} className={`rv-opt ${got ? "pick" : ""} ${part}`}>
            <span className="k">{leftMark(lay.left_style, i)}</span>
            <div>
              <ItemContent item={l} />
              <span className="tag">{got ? <>{t("your_answer")}: <b>→ </b></> : null}{got ? right(got) : t("rv_not_answered")}</span>
              {part !== "ok" && part !== "mid" && (
                <div className="rv-fix"><div><span className="tag">{t("correct_answer")}: <b>{right(key[l.id])}</b></span></div></div>
              )}
            </div>
            <span className="ic" aria-hidden><PartIcon part={part} /></span>
          </div>
        );
      })}
    </div>
  );
}
