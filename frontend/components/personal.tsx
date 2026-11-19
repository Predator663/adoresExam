"use client";
/* Making the app hers: a colour, a frame around her picture, a title from the levels she has reached, and a goal with a progress ring. */
import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { Row, Stepper } from "./settings-ui";
import { Ring } from "./student";
import { AVATAR_EMOJI } from "@/lib/emoji";
import { useMine } from "@/lib/mine";
import { useSession } from "@/lib/session";
import { sfx } from "@/lib/sfx";
import "./personal.css";

export const ACCENTS: [string, string, string, string][] = [  // key, English, Swahili, swatch colour
  ["teal", "Green", "Kijani", "#0b6b4f"], ["ocean", "Ocean", "Bahari", "#1b5fa6"], ["plum", "Plum", "Zambarau", "#7b3d9c"],
  ["rose", "Rose", "Waridi", "#b3315f"], ["amber", "Amber", "Kahawia", "#9a5200"], ["slate", "Slate", "Kijivu", "#3b5772"],
];
const GLYPH: Record<string, string> = { sun: "☀️", leaf: "🌿", flame: "🔥", aurora: "✨", crown: "👑" };
const FRAME_NAME: Record<string, [string, string]> = {
  none: ["Plain", "Wazi"], ring: ["Ring", "Pete"], sun: ["Sunny", "Jua"], leaf: ["Leaf", "Jani"], flame: ["Flame", "Moto"], aurora: ["Aurora", "Aurora"], crown: ["Crown", "Taji"],
};

/** A frame around a round picture (home screen, leaderboard, settings). Unlocked with level. */
export function Frame({ frame, children }: { frame?: string; children: ReactNode }) {
  const f = frame || "ring";
  return <span className={`fr fr-${f}`} data-g={GLYPH[f] || undefined}>{children}</span>;
}

type Prof = { avatar: string; frame: string; frames: { key: string; level: number; unlocked: boolean }[]; title: string; title_level: number | null;
  titles: { level: number; name: string }[]; goal_percent: number | null; goal_subject: string; photo?: string };

/** The "My look" rows of the student's Settings: colour, frame, title and goal. */
export function MyLook({ prof, patch }: { prof: Prof; patch: (b: any) => Promise<void> | void }) {
  const { user, lang, savePrefs } = useSession();
  const L = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const ana = useMine<{ subjects?: { subject: string }[] }>("/student/analytics/");
  const subjects = (ana.data?.subjects || []).map((s) => s.subject);
  const accent = user?.accent || "teal";
  const glyph = AVATAR_EMOJI[prof.avatar] || "🦉";
  return (
    <>
      <Row title={L("Your colour", "Rangi yako")} hint={L("Buttons, rings and highlights follow it. Not used with the high-contrast and colour-blind themes.", "Vitufe, pete na vivutio hufuata rangi hii. Haitumiki kwenye mandhari ya utofautishaji mkubwa na upofu wa rangi.")} stack>
        <div className="pz-swatches" role="radiogroup" aria-label={L("Your colour", "Rangi yako")}>
          {ACCENTS.map(([k, en, sw, c]) => (
            <button key={k} type="button" role="radio" aria-checked={accent === k} className={`pz-sw ${accent === k ? "on" : ""}`} style={{ ["--c" as any]: c }}
              onClick={() => { sfx.pick(); savePrefs({ accent: k }); }}><i aria-hidden /><span>{L(en, sw)}</span></button>
          ))}
        </div>
      </Row>
      <Row title={L("Picture frame", "Fremu ya picha")} hint={L("Better frames unlock as you level up.", "Fremu bora hufunguliwa unapopanda ngazi.")} stack>
        <div className="pz-frames" role="radiogroup" aria-label={L("Picture frame", "Fremu ya picha")}>
          {prof.frames.map((f) => (
            <button key={f.key} type="button" role="radio" aria-checked={prof.frame === f.key} disabled={!f.unlocked} className={`pz-fr ${prof.frame === f.key ? "on" : ""}`}
              title={f.unlocked ? undefined : L(`Unlocks at level ${f.level}`, `Hufunguka ngazi ya ${f.level}`)} onClick={() => { sfx.snap(); patch({ frame: f.key }); }}>
              <Frame frame={f.key}><span className="pz-fr-av" aria-hidden>{f.unlocked ? glyph : "🔒"}</span></Frame>
              <small>{f.unlocked ? L(...FRAME_NAME[f.key] as [string, string]) : L(`Level ${f.level}`, `Ngazi ${f.level}`)}</small>
            </button>
          ))}
        </div>
      </Row>
      <Row title={L("Your title", "Cheo chako")} hint={L("Shown under your name on the class leaderboard. You can use the name of any level you have reached.", "Huonekana chini ya jina lako kwenye orodha ya darasa. Unaweza kutumia jina la ngazi yoyote uliyofikia.")} stack>
        <select className="input" value={prof.title_level ?? ""} aria-label={L("Your title", "Cheo chako")} onChange={(e) => patch({ title_level: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{L("My current level", "Ngazi yangu ya sasa")}</option>
          {prof.titles.map((t) => <option key={t.level} value={t.level}>{t.name}</option>)}
        </select>
      </Row>
      <Row title={L("My goal", "Lengo langu")} hint={L("An average you want to reach. Your progress shows on your home screen.", "Wastani unaotaka kufikia. Maendeleo yako yanaonekana kwenye skrini ya mwanzo.")} stack>
        {prof.goal_percent ? (
          <div className="pz-goal">
            <Stepper label={L("Goal percent", "Asilimia ya lengo")} value={prof.goal_percent} min={40} max={100} step={5} unit="%" presets={[50, 60, 70, 80]} onChange={(n) => patch({ goal_percent: n })} />
            <select className="input" value={prof.goal_subject} aria-label={L("Goal subject", "Somo la lengo")} onChange={(e) => patch({ goal_subject: e.target.value })}>
              <option value="">{L("All my subjects", "Masomo yangu yote")}</option>
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" className="btn ghost" onClick={() => patch({ goal_percent: null, goal_subject: "" })}>{L("Remove goal", "Ondoa lengo")}</button>
          </div>
        ) : <button type="button" className="btn" onClick={() => { sfx.done(); patch({ goal_percent: 70 }); }}>🎯 {L("Set a goal", "Weka lengo")}</button>}
      </Row>
    </>
  );
}

/** Her goal and how close she is, as a ring. With no goal: a friendly invitation. */
export function GoalCard({ prof, subjects }: {
  prof?: { goal_percent: number | null; goal_subject: string }; subjects?: { subject: string; average?: number; exams_taken?: number }[];
}) {
  const { lang } = useSession();
  const L = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const goal = prof?.goal_percent || 0;
  const cur = useMemo(() => {
    const rows = (subjects || []).filter((s) => typeof s.average === "number" && (s.exams_taken ?? 1) > 0);
    const pick = prof?.goal_subject ? rows.filter((s) => s.subject === prof.goal_subject) : rows;
    const w = pick.reduce((a, s) => a + (s.exams_taken || 1), 0);
    return w ? pick.reduce((a, s) => a + s.average! * (s.exams_taken || 1), 0) / w : null;
  }, [subjects, prof?.goal_subject]);
  if (!prof) return null;
  if (!goal) {
    return (
      <section className="card pz-goalcard">
        <Ring value={0} size={64} stroke={5}><span aria-hidden>🎯</span></Ring>
        <div><h2>{L("Set your goal", "Weka lengo lako")}</h2><p className="muted small">{L("Pick an average to aim for and watch the ring fill.", "Chagua wastani wa kulenga na uone pete ikijaa.")}</p>
          <Link href="/settings/#look" className="btn small">{L("Choose a goal", "Chagua lengo")}</Link></div>
      </section>
    );
  }
  const pct = cur === null ? 0 : Math.min(100, (cur / goal) * 100), done = cur !== null && cur >= goal, gap = cur === null ? null : Math.ceil(goal - cur);
  const what = prof.goal_subject || L("all subjects", "masomo yote");
  return (
    <section className={`card pz-goalcard ${done ? "done" : ""}`}>
      <Ring value={pct} size={64} stroke={5} label={L(`Goal progress ${Math.round(pct)} percent`, `Maendeleo ya lengo asilimia ${Math.round(pct)}`)}><b className="pz-goal-n">{cur === null ? "–" : Math.round(cur)}</b></Ring>
      <div>
        <h2>{L("My goal", "Lengo langu")}: {goal}%</h2>
        <p className="muted small">{what}</p>
        <p className="pz-goal-msg">{cur === null ? L("Sit an exam to start your progress.", "Fanya mtihani kuanza maendeleo yako.")
          : done ? L("Goal reached! Raise the bar? 🎉", "Lengo limefikiwa! Ongeza kiwango? 🎉") : L(`${gap} point${gap === 1 ? "" : "s"} to go. You can do it!`, `Pointi ${gap} zimebaki. Unaweza!`)}</p>
      </div>
    </section>
  );
}
