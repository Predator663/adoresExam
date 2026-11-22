import { code128Bars } from "@/lib/code128";

/** A Code 128 barcode as SVG. It scales with its container (set the width in CSS) and stays sharp when printed. A quiet zone of 10 modules
 *  on each side is part of the drawing, as scanners need. Black on white always: it must be scannable whatever theme the app has. */
export default function Barcode({ value, height = 56, label }: { value: string; height?: number; label?: string }) {
  const { bars, width } = code128Bars(value);
  const quiet = 10, total = width + quiet * 2;
  return (
    <svg className="barcode" viewBox={`0 0 ${total} ${height}`} preserveAspectRatio="none" role="img" aria-label={label || `Barcode ${value}`} shapeRendering="crispEdges"
      style={{ width: "100%", height, display: "block", background: "#fff" }}>
      <rect width={total} height={height} fill="#fff" />
      {bars.map(([x, w], i) => <rect key={i} x={x + quiet} y={0} width={w} height={height} fill="#000" />)}
    </svg>
  );
}
