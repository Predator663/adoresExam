/** Study Plan model: learns from one student's own exam history (marks per topic, per exam) and answers three questions:
 *   1. How strong is she in each topic, and how sure are we?        (Bayesian mastery with recency weighting)
 *   2. What will she probably score in the next exam in this subject? (a range, never a single made-up number)
 *   3. Which topics would win her the most marks if she practised them? (what-if)
 *
 *  It runs in the browser on data she already owns, so nothing leaves her phone and the server does no extra work.
 *  Method (kept simple on purpose: with 3 to 10 exams per subject a neural network would only memorise):
 *   - Every topic starts from her overall rate in the subject (the "prior"), worth PRIOR_MARKS marks, so a topic seen in one
 *     tiny question cannot swing wildly.
 *   - Marks she earned and lost are added as evidence, newer exams counting more (each exam back is worth DECAY times less).
 *   - Mastery = Beta posterior mean; the spread of that posterior is the confidence.
 *   - Forecast = mastery of each topic weighted by how much of recent papers that topic fills.
 *   - Its typical error is measured honestly by walk-forward backtest on her own past exams, against two naive baselines
 *     ("same as last time" and "my average"). The range shown to her is built from that measured error.
 */

export type TopicHistory = { exam_id: number; date?: string | null; topics: Record<string, [number, number]> }[];

export const DECAY = 0.7;
export const PRIOR_MARKS = 3;
export const GOAL = 0.85; // "well mastered"; the focus list measures the gap to this
const Z80 = 1.2816, Z90 = 1.645;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export type TopicEstimate = {
  topic: string;
  mastery: number;        // 0..100, her estimated command of the topic now
  low: number; high: number; // 90% range
  weight: number;         // 0..1, how much of a typical paper this topic fills
  evidence: number;       // decayed marks seen: small = we are guessing
  trend: number;          // points, latest exam included vs before it (0 when there is no earlier exam)
  gain: number;           // exam points she could win by bringing this topic up to GOAL
  thin: boolean;          // too little evidence to be sure
};

export type Backtest = { n: number; mae: number; baselineLast: number; baselineMean: number };
export type Plan = {
  exams: number;
  topics: TopicEstimate[];      // weakest-first by gain
  forecast: number | null;      // % expected in the next exam
  low: number | null; high: number | null; // 80% range
  confidence: "low" | "medium" | "high";
  backtest: Backtest | null;
};

type Acc = { earned: number; possible: number };

/** Decayed marks per topic using only the first `upto` exams. */
function accumulate(h: TopicHistory, upto: number) {
  const per = new Map<string, Acc>(), n = upto;
  let totE = 0, totP = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(DECAY, n - 1 - i);
    for (const [t, v] of Object.entries(h[i].topics)) {
      const e = Number(v[0]) || 0, p = Number(v[1]) || 0;
      if (p <= 0) continue;
      const a = per.get(t) ?? { earned: 0, possible: 0 };
      a.earned += w * clamp(e, 0, p); a.possible += w * p; per.set(t, a);
      totE += w * clamp(e, 0, p); totP += w * p;
    }
  }
  return { per, overall: totP > 0 ? totE / totP : 0.5, totP };
}

function estimate(h: TopicHistory, upto: number) {
  const { per, overall, totP } = accumulate(h, upto);
  const a0 = PRIOR_MARKS * overall, b0 = PRIOR_MARKS * (1 - overall);
  const out: Omit<TopicEstimate, "trend" | "gain">[] = [];
  for (const [topic, acc] of per) {
    const a = a0 + acc.earned, b = b0 + (acc.possible - acc.earned), s = a + b;
    const m = a / s, sd = Math.sqrt((a * b) / (s * s * (s + 1)));
    out.push({ topic, mastery: m * 100, low: clamp((m - Z90 * sd) * 100, 0, 100), high: clamp((m + Z90 * sd) * 100, 0, 100),
      weight: totP > 0 ? acc.possible / totP : 0, evidence: acc.possible, thin: acc.possible < 4 });
  }
  return out;
}

const composite = (t: { mastery: number; weight: number }[]) => t.reduce((s, x) => s + x.weight * x.mastery, 0);
const examPercent = (e: TopicHistory[number]) => {
  let g = 0, p = 0;
  for (const v of Object.values(e.topics)) { g += clamp(Number(v[0]) || 0, 0, Number(v[1]) || 0); p += Number(v[1]) || 0; }
  return p > 0 ? (g / p) * 100 : null;
};

/** Walk forward through her own past: predict exam k from exams before k, compare with what happened. */
export function backtest(h: TopicHistory): Backtest | null {
  let n = 0, err = 0, errLast = 0, errMean = 0;
  for (let k = 2; k < h.length; k++) {
    const actual = examPercent(h[k]);
    if (actual === null) continue;
    const prior = h.slice(0, k).map(examPercent).filter((x): x is number => x !== null);
    if (prior.length < 2) continue;
    const pred = composite(estimate(h, k));
    err += Math.abs(pred - actual);
    errLast += Math.abs(prior[prior.length - 1] - actual);
    errMean += Math.abs(prior.reduce((s, x) => s + x, 0) / prior.length - actual);
    n++;
  }
  return n ? { n, mae: err / n, baselineLast: errLast / n, baselineMean: errMean / n } : null;
}

export function makePlan(history: TopicHistory | undefined | null): Plan {
  const h = (history ?? []).filter((e) => e && e.topics && Object.keys(e.topics).length);
  if (!h.length) return { exams: 0, topics: [], forecast: null, low: null, high: null, confidence: "low", backtest: null };
  const now = estimate(h, h.length);
  const before = h.length > 1 ? new Map(estimate(h, h.length - 1).map((x) => [x.topic, x.mastery])) : new Map<string, number>();
  const topics: TopicEstimate[] = now.map((x) => ({
    ...x, trend: before.has(x.topic) ? x.mastery - (before.get(x.topic) as number) : 0,
    gain: x.weight * Math.max(0, GOAL * 100 - x.mastery),
  }));
  topics.sort((a, b) => b.gain - a.gain || a.mastery - b.mastery);
  if (h.length < 2) return { exams: h.length, topics, forecast: null, low: null, high: null, confidence: "low", backtest: null };

  const forecast = clamp(composite(topics), 0, 100);
  const bt = backtest(h);
  const sd = Math.sqrt(now.reduce((s, x) => s + x.weight * x.weight * (((x.high - x.low) / (2 * Z90)) ** 2), 0));
  // Half-width of the 80% range: what her own past misses say, or (too few exams to measure) what the topic uncertainty says.
  const half = clamp(bt && bt.n >= 2 ? Math.max(6, 1.9 * bt.mae) : Math.max(10, Z80 * sd + 8), 4, 25);
  const confidence = h.length >= 5 && half <= 10 ? "high" : h.length >= 3 && half <= 16 ? "medium" : "low";
  return { exams: h.length, topics, forecast, low: clamp(forecast - half, 0, 100), high: clamp(forecast + half, 0, 100), confidence, backtest: bt };
}

/** "What if I bring this topic up by `points` points?" Returns the new forecast. */
export function whatIf(plan: Plan, topic: string, points: number): number | null {
  if (plan.forecast === null) return null;
  const t = plan.topics.find((x) => x.topic === topic);
  if (!t) return plan.forecast;
  return clamp(plan.forecast + t.weight * Math.min(Math.max(points, 0), 100 - t.mastery), 0, 100);
}
