/** Sanity check of the study-plan model on simulated students. Run:  npx tsx lib/studyplan.check.ts
 *  Each simulated student has a hidden ability per topic that slowly improves; exams are 20 one-mark questions over 4 of 6 topics. */
import { makePlan, whatIf, type TopicHistory } from "./studyplan";

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const TOPICS = ["Algebra", "Geometry", "Statistics", "Probability", "Trigonometry", "Sets"];

const students = 400, exams = 8;
let n = 0, eModel = 0, eLast = 0, eMean = 0, covered = 0, widthSum = 0;
for (let s = 0; s < students; s++) {
  const base = Math.min(0.95, Math.max(0.2, 0.55 + 0.17 * gauss()));
  const ability = TOPICS.map(() => Math.min(0.97, Math.max(0.05, base + 0.15 * gauss())));
  const gain = 0.01 + 0.02 * rnd();
  const h: TopicHistory = [], pct: number[] = [];
  for (let e = 0; e < exams; e++) {
    const picked = [...TOPICS].sort(() => rnd() - 0.5).slice(0, 4), topics: Record<string, [number, number]> = {};
    let g = 0;
    for (let q = 0; q < 20; q++) {
      const t = picked[q % 4], i = TOPICS.indexOf(t);
      topics[t] = topics[t] || [0, 0];
      topics[t][1] += 1;
      if (rnd() < Math.min(0.98, ability[i] + gain * e)) { topics[t][0] += 1; g++; }
    }
    h.push({ exam_id: e, topics }); pct.push((g / 20) * 100);
  }
  for (let k = 3; k < exams; k++) {
    const p = makePlan(h.slice(0, k));
    if (p.forecast === null) continue;
    n++;
    eModel += Math.abs(p.forecast - pct[k]);
    eLast += Math.abs(pct[k - 1] - pct[k]);
    eMean += Math.abs(pct.slice(0, k).reduce((a, b) => a + b, 0) / k - pct[k]);
    if (pct[k] >= (p.low as number) && pct[k] <= (p.high as number)) covered++;
    widthSum += (p.high as number) - (p.low as number);
  }
}
const f = (x: number) => x.toFixed(2);
console.log(`forecasts: ${n}`);
console.log(`typical miss (points):  model ${f(eModel / n)}   |   "same as last time" ${f(eLast / n)}   |   "my average" ${f(eMean / n)}`);
console.log(`the 80% range really contained the result ${f((covered / n) * 100)}% of the time (average width ${f(widthSum / n)} points)`);

// Unit checks
const one = makePlan([{ exam_id: 1, topics: { A: [1, 2] } }]);
console.assert(one.forecast === null && one.confidence === "low", "one exam must not produce a forecast");
const empty = makePlan(undefined);
console.assert(empty.exams === 0 && empty.topics.length === 0, "empty history");
const two = makePlan([{ exam_id: 1, topics: { A: [2, 10], B: [9, 10] } }, { exam_id: 2, topics: { A: [3, 10], B: [10, 10] } }]);
console.assert(two.topics[0].topic === "A", "weak, heavy topic must come first");
console.assert(two.forecast !== null && two.forecast > 40 && two.forecast < 75, "forecast sane");
const up = whatIf(two, "A", 20) as number;
console.assert(up > (two.forecast as number), "improving a topic must raise the forecast");
console.assert(whatIf(two, "A", 1000) as number <= 100, "forecast never above 100");
console.log("unit checks done");
