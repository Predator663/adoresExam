"use client";
import { useRef } from "react";
import { ItemContent, RichHtml } from "./Rich";
import SortList from "./SortList";
import SymbolPad from "./SymbolPad";
import { leftMark, matchLayout, rightMark, rightTag } from "@/lib/labels";
import { useSession } from "@/lib/session";
import type { Question } from "@/lib/types";

/** The six auto-marked question types (QB-01). `value` is exactly what the API expects as the response. */
export function initialValue(q: Question): any {
  if (q.type === "ordering") return ((q.content?.items || []) as any[]).map((i) => i.id);
  if (q.type === "mcq_multi") return [];
  if (q.type === "matching") return {};
  if (q.type === "fill_blank") return "";
  return undefined;
}
export function hasAnswer(q: Question, v: any): boolean {
  if (q.type === "mcq_multi") return Array.isArray(v) && v.length > 0;
  if (q.type === "matching") return v && Object.keys(v).length > 0;
  if (q.type === "fill_blank") return typeof v === "string" && v.trim() !== "";
  if (q.type === "ordering") return Array.isArray(v) && v.length > 0;
  return v !== undefined && v !== null;
}

const KEYS = "ABCDEFGHIJ";

export default function QuestionView({ q, value, onChange, disabled }: { q: Question; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const { t } = useSession();
  const answerRef = useRef<HTMLInputElement>(null);
  const c = q.content || {};
  // Ordering: `value` can be undefined (builder preview) or stale (items edited). Always rebuild a valid order.
  const items: any[] = c.items || [];
  const itemIds: string[] = items.map((x: any) => x.id);
  const order: string[] = q.type === "ordering"
    ? [...(Array.isArray(value) ? (value as string[]).filter((id) => itemIds.includes(id)) : []), ...itemIds.filter((id) => !(Array.isArray(value) ? value : []).includes(id))]
    : [];
  return (
    <div className="question">
      <div data-seg="prompt"><RichHtml html={q.prompt} className="prompt" /></div>
      <p data-seg="marks" className="muted small">{q.marks === 1 ? t("mark_one") : t("marks_n", { n: q.marks })}</p>

      {q.type === "mcq_single" && (
        <div role="radiogroup" aria-label={t("choose_one")} className="options">
          {c.options.map((o: any, i: number) => (
            <label key={o.id} data-seg={`opt-${o.id}`} className={`opt keyed ${value === o.id ? "on" : ""}`}>
              <input type="radio" name={`q${q.id}`} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
              <span className="opt-key" aria-hidden>{KEYS[i] || i + 1}</span>
              <ItemContent item={o} />
            </label>
          ))}
        </div>
      )}

      {q.type === "mcq_multi" && (
        <div role="group" aria-label={t("choose_many")} className="options">
          <p className="muted small">{t("choose_many")}</p>
          {c.options.map((o: any, i: number) => {
            const on = (value || []).includes(o.id);
            return (
              <label key={o.id} data-seg={`opt-${o.id}`} className={`opt keyed ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} disabled={disabled}
                  onChange={() => onChange(on ? value.filter((x: string) => x !== o.id) : [...(value || []), o.id])} />
                <span className="opt-key sq" aria-hidden>{KEYS[i] || i + 1}</span>
                <ItemContent item={o} />
              </label>
            );
          })}
        </div>
      )}

      {q.type === "true_false" && (
        <div role="radiogroup" data-seg="tf" aria-label={t("true_or_false")} className="options row2">
          {[true, false].map((b) => (
            <label key={String(b)} className={`opt center-text ${value === b ? "on" : ""}`}>
              <input type="radio" name={`q${q.id}`} checked={value === b} disabled={disabled} onChange={() => onChange(b)} />
              <span>{b ? t("true") : t("false")}</span>
            </label>
          ))}
        </div>
      )}

      {q.type === "fill_blank" && (
        <div>
          <div className="row">
            <input ref={answerRef} className={`input fb-${c.width || "medium"}`} value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}
              aria-label={t("your_answer")} placeholder={t("type_answer")} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode={c.input === "number" ? "decimal" : "text"} />
            {c.unit && <span className="fb-unit">{c.unit}</span>}
            {!disabled && <SymbolPad target={answerRef} value={value || ""} onChange={onChange} label="Ω" aria="Symbols / Alama" small />}
          </div>
          {c.hint && <p className="muted small fb-hint">{c.hint}</p>}
        </div>
      )}

      {q.type === "matching" && (() => {
        const lay = matchLayout(c), chosen: Record<string, string> = value || {};
        const plainText = (it: any) => (it.text || "").replace(/<[^>]+>/g, "") || it.alt_text || "";
        return (
          <div className="mt">
            <p className="muted small">{t("match_help")}</p>
            <div className="mt-cols">
              <section className="mt-col" aria-label={lay.left_title || t("col_a")}>
                <h4 className="mt-h">{lay.left_title || t("col_a")}</h4>
                {c.left.map((l: any, i: number) => {
                  const usedElsewhere = new Set(Object.entries(chosen).filter(([k]) => k !== l.id).map(([, v]) => v));
                  return (
                    <div key={l.id} data-seg={`opt-${l.id}`} className={`mt-row ${chosen[l.id] ? "done" : ""}`}>
                      <span className="mt-mark">{leftMark(lay.left_style, i)}</span>
                      <div className="mt-item"><ItemContent item={l} /></div>
                      <select className="input mt-sel" value={chosen[l.id] || ""} disabled={disabled} aria-label={`${leftMark(lay.left_style, i)} ${plainText(l)}: ${t("match_with")}`}
                        onChange={(e) => onChange({ ...chosen, [l.id]: e.target.value })}>
                        <option value="">—</option>
                        {c.right.map((r: any, j: number) => <option key={r.id} value={r.id} disabled={lay.unique && usedElsewhere.has(r.id)}>{rightTag(lay.right_style, j)}</option>)}
                      </select>
                    </div>
                  );
                })}
              </section>
              <section className="mt-col" aria-label={lay.right_title || t("col_b")}>
                <h4 className="mt-h">{lay.right_title || t("col_b")}</h4>
                {c.right.map((r: any, j: number) => (
                  <div key={r.id} data-seg={`opt-${r.id}`} className="mt-row mt-ref"><span className="mt-mark">{rightMark(lay.right_style, j)}</span><div className="mt-item"><ItemContent item={r} /></div></div>
                ))}
              </section>
            </div>
          </div>
        );
      })()}

      {q.type === "ordering" && <SortList order={order} items={items} onChange={onChange} disabled={disabled} />}
    </div>
  );
}
