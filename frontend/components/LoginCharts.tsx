"use client";
/** Small charts drawn with plain SVG (no chart library, so the app stays light and works offline). Colours come from the theme variables,
 *  so dark mode, high contrast and the colour-blind theme all work. Every chart has a text summary and can be shown as a table (ACC-05). */

const niceMax = (m: number) => {
  if (m <= 4) return Math.max(m, 1);
  const p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

export function BarChart({ values, labels, title, unit, tickEvery = 1, height = 170, showTable = true }: {
  values: number[]; labels: string[]; title: string; unit: string; tickEvery?: number; height?: number; showTable?: boolean;
}) {
  const n = values.length, W = 720, L = 34, B = 22, T = 8, H = height;
  const max = niceMax(Math.max(0, ...values)), slot = (W - L) / Math.max(n, 1), bw = Math.max(1, slot * 0.72);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const total = values.reduce((a, b) => a + b, 0), peak = values.indexOf(Math.max(...values, 0));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. Total ${total} ${unit}.${total ? ` Highest: ${labels[peak]} with ${values[peak]}.` : ""}`} style={{ display: "block", maxHeight: H * 1.6 }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 5} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{Math.round(max * f)}</text>
          </g>
        ))}
        {values.map((v, i) => (
          <g key={i}>
            <rect x={L + i * slot + (slot - bw) / 2} y={y(v)} width={bw} height={Math.max(v > 0 ? 2 : 0, y(0) - y(v))} rx={Math.min(3, bw / 3)} fill="var(--primary)"><title>{`${labels[i]}: ${v} ${unit}`}</title></rect>
            {i % tickEvery === 0 && <text x={L + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{labels[i]}</text>}
          </g>
        ))}
      </svg>
      {showTable && (
        <details className="small" style={{ marginTop: ".3rem" }}>
          <summary className="muted">Show as a table</summary>
          <div className="tbl-wrap" style={{ maxHeight: 220, overflow: "auto" }}><table><thead><tr><th>{title}</th><th>{unit}</th></tr></thead>
            <tbody>{values.map((v, i) => <tr key={i}><td>{labels[i]}</td><td>{v}</td></tr>)}</tbody></table></div>
        </details>
      )}
    </figure>
  );
}

/** One row per band: label, a bar sized by the share of students, and the count. */
export function BandChart({ bands, total }: { bands: { label: string; count: number }[]; total: number }) {
  return (
    <div role="list" aria-label="Students by number of days they logged in">
      {bands.map((b) => {
        const pct = total ? (b.count / total) * 100 : 0;
        return (
          <div key={b.label} role="listitem" style={{ margin: ".55rem 0" }}>
            <div className="row"><span className="grow">{b.label}</span><b>{b.count}</b><span className="muted small" style={{ minWidth: "3.2rem", textAlign: "right" }}>{Math.round(pct)}%</span></div>
            <div className="bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}
