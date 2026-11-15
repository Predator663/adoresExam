"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PagedList } from "@/components/Pager";
import Icon from "@/components/Icon";
import Shell from "@/components/Shell";
import StaffNav from "@/components/StaffNav";
import { Row, Section, SaveBar, Seg, Slider, Stepper, Switch, ThemePicker } from "@/components/settings-ui";
import { ErrorNote, Loading, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { errorLines } from "@/lib/staff";
import { useSession } from "@/lib/session";

const NECTA = { grades: [
  { grade: "A", min: 75, max: 100, meaning: "Excellent", points: 1 }, { grade: "B", min: 65, max: 74, meaning: "Very good", points: 2 }, { grade: "C", min: 45, max: 64, meaning: "Good", points: 3 },
  { grade: "D", min: 30, max: 44, meaning: "Satisfactory (pass)", points: 4 }, { grade: "F", min: 0, max: 29, meaning: "Fail", points: 5 }],
  divisions: [{ division: "I", min: 7, max: 17, meaning: "Excellent" }, { division: "II", min: 18, max: 21, meaning: "Very good" }, { division: "III", min: 22, max: 25, meaning: "Good" },
    { division: "IV", min: 26, max: 33, meaning: "Pass" }, { division: "0", min: 34, max: 999, meaning: "Fail" }], subjects_counted: 7 };

/** Which saved fields belong to which section (drives the "unsaved" dots and the change count). */
const FIELDS: Record<string, string[]> = {
  school: ["school_name", "short_name", "contact_email", "contact_phone", "address", "rules_text", "default_theme", "default_language"],
  exams: ["result_delay_minutes", "late_entry_minutes", "show_class_position"],
  anticheat: ["proximity_alert_meters", "proximity_lock_enabled", "leave_lock_enabled", "leave_lock_limit"],
  students: ["leaderboard_enabled", "practice_default_count", "student_photos_enabled"],
};
const SCHOOL_KEYS = Object.values(FIELDS).flat();
const GAM_KEYS = ["xp_values", "levels", "badge_tiers", "freezes_per_month", "practice_daily_xp_quizzes"];
const NAV: { group: string; items: [string, string, string, string][] }[] = [
  { group: "School", items: [["school", "Profile", "Name, logo, look", "building"], ["exams", "Exams & results", "Timing, positions", "clock"], ["anticheat", "Anti-cheat", "Locks and alerts", "shield"]] },
  { group: "Students", items: [["students", "Students & practice", "Photos, leaderboard", "users"], ["xp", "XP & badges", "Rewards, levels", "medal"]] },
  { group: "Academics", items: [["grading", "Grading scale", "Grades, divisions", "chart"], ["classes", "Classes", "Forms and streams", "layers"], ["subjects", "Subjects", "Practice per subject", "book"], ["terms", "Years & terms", "Calendar", "calendar"]] },
];
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const pretty = (k: string) => k.replace(/_/g, " ");

export default function Settings() {
  const { user } = useSession();
  const admin = user?.role === "admin" || user?.role === "super_admin";
  const [sec, setSec] = useState("school");
  const main = useLoad(() => api<any>("/settings/"));
  const gam = useLoad(() => api<any>("/gamification/settings/"));
  const [v, setV] = useState<any>(null), [g, setG] = useState<any>(null);
  const base = useRef<{ v: any; g: any }>({ v: null, g: null });
  const [busy, setBusy] = useState(false), [errs, setErrs] = useState<string[]>([]), [saved, setSaved] = useState("");
  const toast = useRef<any>(null);

  useEffect(() => { if (main.data) { const d = clone(main.data); base.current.v = d; setV(clone(d)); } }, [main.data]);
  useEffect(() => {
    if (gam.data) { const d = clone(Object.fromEntries(GAM_KEYS.map((k) => [k, gam.data[k]]))); base.current.g = d; setG(clone(d)); }
  }, [gam.data]);

  const changedKeys = useMemo(() => (v && base.current.v ? SCHOOL_KEYS.filter((k) => !same(v[k], base.current.v[k])) : []), [v]);
  const gradeDirty = !!(v && base.current.v && !same(v.grade_scale, base.current.v.grade_scale));
  const gamKeys = useMemo(() => (g && base.current.g ? GAM_KEYS.filter((k) => !same(g[k], base.current.g[k])) : []), [g]);
  const count = changedKeys.length + (gradeDirty ? 1 : 0) + gamKeys.length;
  const dirtySec = (id: string) => (FIELDS[id] ? FIELDS[id].some((k) => changedKeys.includes(k)) : id === "grading" ? gradeDirty : id === "xp" ? gamKeys.length > 0 : false);
  const ch = (k: string) => changedKeys.includes(k);

  useEffect(() => {
    if (!count) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [count]);
  useEffect(() => () => clearTimeout(toast.current), []);

  const up = (p: any) => { setSaved(""); setErrs([]); setV((o: any) => ({ ...o, ...p })); };
  const upG = (p: any) => { setSaved(""); setErrs([]); setG((o: any) => ({ ...o, ...p })); };

  async function save() {
    setBusy(true); setErrs([]); setSaved("");
    const bad: string[] = [];
    if (changedKeys.length || gradeDirty) {
      try {
        const body: any = Object.fromEntries(changedKeys.map((k) => [k, v[k]]));
        if (gradeDirty) body.grade_scale = v.grade_scale;
        const r = await api<any>("/settings/", { method: "PATCH", body });
        base.current.v = clone(r); setV(clone(r));
      } catch (e: any) { bad.push(...errorLines(e.data?.errors || e.data, e.message)); }
    }
    if (gamKeys.length) {
      try {
        await api("/gamification/settings/", { method: "PATCH", body: g });
        base.current.g = clone(g); gam.reload();
      } catch (e: any) { bad.push(...errorLines(e.data?.errors || e.data, e.message)); }
    }
    setBusy(false);
    if (bad.length) { setErrs(bad); return; }
    setSaved("All changes saved");
    clearTimeout(toast.current); toast.current = setTimeout(() => setSaved(""), 3200);
  }
  function discard() { setV(clone(base.current.v)); setG(clone(base.current.g)); setErrs([]); setSaved(""); }
  function go(id: string) {
    setSec(id); setErrs([]);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  if (!admin) return <Shell bare title="Settings"><StaffNav /><p>Only administrators can change settings.</p></Shell>;
  const ready = v && g;
  const cur = NAV.flatMap((n) => n.items).find((i) => i[0] === sec)!;

  return (
    <Shell bare title="Settings">
      <StaffNav />
      {(main.loading || gam.loading) && !ready ? <Loading /> : main.error ? <ErrorNote error={main.error} retry={main.reload} /> : gam.error ? <ErrorNote error={gam.error} retry={gam.reload} /> : !ready ? <Loading /> : (
        <div className="st">
          <nav className="st-nav" aria-label="Settings sections">
            {NAV.map((n) => (
              <Fragment key={n.group}>
                <h3>{n.group}</h3>
                {n.items.map(([id, name, hint, ic]) => (
                  <button key={id} type="button" className={sec === id ? "on" : ""} aria-current={sec === id ? "page" : undefined} onClick={() => go(id)}>
                    <span className="ic"><Icon n={ic} size={18} /></span><span className="pic"><Icon n={ic} size={16} /></span>
                    <span>{name}</span><small>{hint}</small>
                    {dirtySec(id) && <i className="dot" style={{ gridColumn: 3, gridRow: "1 / 3" }} aria-label="Unsaved changes" />}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>
          <div className="st-main" key={sec}>
            <div className="st-head"><h1>{cur[1]}</h1><p>{cur[2]}</p></div>
            {sec === "school" && <ProfileSec v={v} up={up} ch={ch} reload={() => { main.reload(); }} />}
            {sec === "exams" && <ExamsSec v={v} up={up} ch={ch} />}
            {sec === "anticheat" && <AntiSec v={v} up={up} ch={ch} />}
            {sec === "students" && <StudentsSec v={v} up={up} ch={ch} g={g} upG={upG} />}
            {sec === "xp" && <XpSec g={g} upG={upG} def={gam.data.defaults} reset={async () => { setBusy(true); try { await api("/gamification/settings/", { method: "PATCH", body: { reset: true } }); gam.reload(); setSaved("Reset to the defaults"); } catch (e: any) { setErrs(errorLines(e.data?.errors || e.data, e.message)); } setBusy(false); }} />}
            {sec === "grading" && <GradingSec v={v} up={up} />}
            {sec === "classes" && <ClassesSec />}
            {sec === "subjects" && <SubjectsSec />}
            {sec === "terms" && <TermsSec />}
          </div>
        </div>
      )}
      <SaveBar dirty={count > 0} count={count} busy={busy} errors={errs} saved={saved} onSave={save} onDiscard={discard} />
    </Shell>
  );
}

type P = { v: any; up: (p: any) => void; ch: (k: string) => boolean };
const text = (v: any, k: string, up: (p: any) => void, label: string, extra: any = {}) => (
  <label className="field"><span>{label}</span><input className="input" value={v[k] ?? ""} onChange={(e) => up({ [k]: e.target.value })} {...extra} /></label>
);

function ProfileSec({ v, up, ch, reload }: P & { reload: () => void }) {
  const [msg, setMsg] = useState(""), [drag, setDrag] = useState(false);
  const name = (v.short_name || (v.school_name || "").split(" ")[0] || "School").trim();
  async function logo(f?: File) {
    if (!f) return; setMsg("");
    const fd = new FormData(); fd.append("logo", f);
    try { const r = await api<any>("/settings/logo/", { body: fd }); up({ logo_url: r.logo_url }); setMsg("Logo updated."); reload(); } catch (e: any) { setMsg(e.message || "Could not upload the logo."); }
  }
  return (
    <>
      <Section icon="building" title="School identity" hint="Shown on the sign-in page, results and the About pages." h={150} i={0}>
        <div className="st-brand">
          <label className={`st-logo ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); logo(e.dataTransfer.files?.[0]); }}>
            {v.logo_url ? <img src={v.logo_url} alt="School logo" /> : <>{name.slice(0, 1).toUpperCase()}</>}
            <span>Change logo</span><input type="file" accept="image/*" hidden onChange={(e) => logo(e.target.files?.[0])} />
          </label>
          <div className="st-brand-t"><b>{v.school_name || "Your school"}</b><small>The app appears as “{name} Exams”</small></div>
        </div>
        {msg && <p className="muted small" role="status">{msg}</p>}
        <div className="st-grid">
          {text(v, "school_name", up, "School name")}
          {text(v, "short_name", up, "Short name (empty = first word)", { maxLength: 40 })}
          {text(v, "contact_email", up, "Contact e-mail", { type: "email", maxLength: 120 })}
          {text(v, "contact_phone", up, "Contact phone", { maxLength: 40 })}
        </div>
        <div className="st-grid" style={{ gridTemplateColumns: "1fr" }}>{text(v, "address", up, "Address", { maxLength: 200 })}</div>
      </Section>
      <Section icon="sun" title="Look and language" hint="What new users see before they pick their own." h={40} i={1}>
        <Row title="Default theme" hint="Each person can still choose their own in their settings." stack changed={ch("default_theme")}><ThemePicker value={v.default_theme} onChange={(t) => up({ default_theme: t })} /></Row>
        <Row title="Default language" changed={ch("default_language")}><Seg label="Default language" value={v.default_language} onChange={(l) => up({ default_language: l })} opts={[["en", "English"], ["sw", "Kiswahili"]]} /></Row>
      </Section>
      <Section icon="file" title="Default exam rules" hint="Shown when an exam has no rules of its own." h={200} i={2}>
        <Row title="Rules text" stack changed={ch("rules_text")}><textarea className="input" rows={5} value={v.rules_text ?? ""} onChange={(e) => up({ rules_text: e.target.value })} /></Row>
      </Section>
    </>
  );
}

function ExamsSec({ v, up, ch }: P) {
  return (
    <Section icon="clock" title="Timing and results" hint="When students can enter and when they see their marks." h={210} i={0}>
      <Row title="Result delay" hint="Results appear this long after the exam closes. 0 shows them at once." changed={ch("result_delay_minutes")}>
        <Stepper label="Result delay" value={v.result_delay_minutes} onChange={(n) => up({ result_delay_minutes: n })} min={0} max={1440} step={5} unit="min" presets={[0, 15, 30, 60, 120, 1440]} />
      </Row>
      <Row title="Late-entry window" hint="How long after the start a student may still begin. No time is added to her exam." changed={ch("late_entry_minutes")}>
        <Slider label="Late entry" value={v.late_entry_minutes} onChange={(n) => up({ late_entry_minutes: n })} min={0} max={180} unit="min" marks={[[0, "None"], [15, "15"], [30, "30"], [60, "60"], [180, "180"]]} />
      </Row>
      <Row title="Show class position" hint="Adds “3rd of 42” to each student's result." changed={ch("show_class_position")}><Switch label="Show class position" on={!!v.show_class_position} onChange={(b) => up({ show_class_position: b })} /></Row>
    </Section>
  );
}

function AntiSec({ v, up, ch }: P) {
  const leave = v.leave_lock_enabled ?? true;
  return (
    <>
      <Section icon="pin" title="Sitting too close" hint="Two students of one exam nearer than this raise an alert in Live monitor." h={10} i={0}>
        <Row title="Alert distance" hint="Phones indoors are only accurate to about 5–15 m, so very small values can miss real cases." changed={ch("proximity_alert_meters")}>
          <Slider label="Alert distance" value={v.proximity_alert_meters ?? 20} onChange={(n) => up({ proximity_alert_meters: n })} min={1} max={100} unit="m" marks={[[1, "1"], [10, "10"], [20, "20"], [50, "50"], [100, "100"]]} />
        </Row>
        <Row title="Lock students who sit closer" hint="Both see a banner to move apart and cannot answer until you unlock them. Their timer keeps running. Switching off releases everyone locked." changed={ch("proximity_lock_enabled")}>
          <Switch label="Lock students who sit closer" on={!!v.proximity_lock_enabled} onChange={(b) => up({ proximity_lock_enabled: b })} />
        </Row>
      </Section>
      <Section icon="eye" title="Leaving the exam screen" hint="Every switch of app, tab or screen is counted and shown in Live monitor." h={30} i={1}>
        <Row title="Lock after too many exits" hint="Unlocking gives a fresh allowance. Switching off releases students locked this way (hand locks stay)." changed={ch("leave_lock_enabled")}>
          <Switch label="Lock after too many exits" on={leave} onChange={(b) => up({ leave_lock_enabled: b })} />
        </Row>
        <Row title="Exits allowed" hint={`The first ${v.leave_lock_limit ?? 3} only warn her; the next one locks her exam.`} changed={ch("leave_lock_limit")}>
          <div style={{ opacity: leave ? 1 : .45, pointerEvents: leave ? "auto" : "none", transition: "opacity .3s" }}>
            <Stepper label="Exits allowed" value={v.leave_lock_limit ?? 3} onChange={(n) => up({ leave_lock_limit: n })} min={0} max={50} presets={[0, 1, 2, 3, 5, 10]} />
          </div>
        </Row>
      </Section>
    </>
  );
}

function StudentsSec({ v, up, ch, g, upG }: P & { g: any; upG: (p: any) => void }) {
  return (
    <>
      <Section icon="star" title="Practice" hint="Self-study quizzes and the rewards around them." h={90} i={0}>
        <Row title="Default quiz length" hint="How many questions a practice quiz starts with. Students can still change it." changed={ch("practice_default_count")}>
          <Seg label="Default quiz length" value={Number(v.practice_default_count ?? 10)} onChange={(n) => up({ practice_default_count: n })} opts={[[5, "5"], [10, "10"], [15, "15"], [20, "20"]]} />
        </Row>
        <Row title="Quizzes per day that earn XP" hint="Extra quizzes are still allowed but give no XP.">
          <Stepper label="Quizzes per day that earn XP" value={g.practice_daily_xp_quizzes} onChange={(n) => upG({ practice_daily_xp_quizzes: n })} min={1} max={50} presets={[3, 5, 10, 20]} />
        </Row>
        <Row title="Streak freezes per month" hint="A freeze keeps a streak alive when a student misses a day." >
          <Stepper label="Streak freezes per month" value={g.freezes_per_month} onChange={(n) => upG({ freezes_per_month: n })} min={0} max={10} presets={[0, 1, 2, 3]} />
        </Row>
      </Section>
      <Section icon="users" title="Profiles and competition" h={200} i={1}>
        <Row title="Student profile photos" hint="When off, students use an emoji avatar and cannot upload a photo." changed={ch("student_photos_enabled")}>
          <Switch label="Student profile photos" on={v.student_photos_enabled !== false} onChange={(b) => up({ student_photos_enabled: b })} />
        </Row>
        <Row title="Class leaderboard" hint="Ranks classes by XP only, never by exam marks." changed={ch("leaderboard_enabled")}>
          <Switch label="Class leaderboard" on={!!v.leaderboard_enabled} onChange={(b) => up({ leaderboard_enabled: b })} />
        </Row>
      </Section>
    </>
  );
}

function XpSec({ g, upG, def, reset }: { g: any; upG: (p: any) => void; def: any; reset: () => void }) {
  const setLv = (i: number, p: any) => upG({ levels: g.levels.map((x: any, j: number) => (j === i ? { ...x, ...p } : x)) });
  return (
    <>
      <Section icon="zap" title="XP values" hint="How much each action earns." h={50} i={0}>
        <div className="st-grid">{Object.keys(def.xp_values).map((k) => (
          <label key={k} className="field"><span style={{ textTransform: "capitalize" }}>{pretty(k)} <small className="muted">(default {def.xp_values[k]})</small></span>
            <input className="input" type="number" inputMode="numeric" min={0} max={1000} value={g.xp_values[k] ?? ""} onChange={(e) => upG({ xp_values: { ...g.xp_values, [k]: Number(e.target.value) } })} /></label>))}</div>
      </Section>
      <Section icon="trend" title="Levels" hint="The XP a student needs to reach each level." h={120} i={1}>
        <div className="st-tbl"><div className="st-th" style={{ gridTemplateColumns: "44px minmax(0,1fr) minmax(0,1fr) 120px" }}><span>#</span><span>Name</span><span>Kiswahili</span><span>XP</span></div>
          {g.levels.map((l: any, i: number) => (
            <div key={i} className="st-tr lv" style={{ "--i": i } as any}><div><b>{l.level}</b></div>
              <div><span className="st-lbl">Name</span><input className="input" aria-label="Name" value={l.name} onChange={(e) => setLv(i, { name: e.target.value })} /></div>
              <div><span className="st-lbl">Kiswahili</span><input className="input" aria-label="Kiswahili name" value={l.name_sw} onChange={(e) => setLv(i, { name_sw: e.target.value })} /></div>
              <div><span className="st-lbl">XP needed</span><input className="input" type="number" inputMode="numeric" aria-label="XP" value={l.xp} onChange={(e) => setLv(i, { xp: Number(e.target.value) })} /></div></div>))}</div>
      </Section>
      <Section icon="medal" title="Badge targets" hint="What it takes to earn bronze, silver and gold." h={45} i={2}>
        <div className="st-badge-row" aria-hidden style={{ color: "var(--muted)", fontSize: ".75rem", fontWeight: 800 }}><span /> <span>Bronze</span><span>Silver</span><span>Gold</span></div>
        {Object.keys(def.badge_tiers).map((code) => (
          <div key={code} className="st-badge-row"><span style={{ textTransform: "capitalize" }}>{pretty(code)}</span>
            {[0, 1, 2].map((i) => <input key={i} className="input" type="number" inputMode="numeric" min={1} aria-label={`${code} ${["bronze", "silver", "gold"][i]}`} value={(g.badge_tiers[code] || def.badge_tiers[code])[i]}
              onChange={(e) => { const t = [...(g.badge_tiers[code] || def.badge_tiers[code])]; t[i] = Number(e.target.value); upG({ badge_tiers: { ...g.badge_tiers, [code]: t } }); }} />)}</div>))}
        <div className="st-actions" style={{ marginTop: ".8rem" }}><button type="button" className="btn danger" onClick={() => confirm("Go back to the default XP, levels and badge targets? This saves straight away.") && reset()}>Reset to defaults</button></div>
      </Section>
    </>
  );
}

function GradingSec({ v, up }: { v: any; up: (p: any) => void }) {
  const sc = v.grade_scale;
  const set = (n: any) => up({ grade_scale: n });
  const setG = (i: number, p: any) => set({ ...sc, grades: sc.grades.map((g: any, j: number) => (j === i ? { ...g, ...p } : g)) });
  const setD = (i: number, p: any) => set({ ...sc, divisions: sc.divisions.map((g: any, j: number) => (j === i ? { ...g, ...p } : g)) });
  const num = (val: any, f: (x: number) => void, label: string) => <input className="input" type="number" inputMode="numeric" aria-label={label} value={val} onChange={(e) => f(Number(e.target.value))} />;
  return (
    <>
      <Section icon="chart" title="Subject grades" hint="Defaults follow the NECTA O-Level scale; please verify against official NECTA publications." h={20} i={0}>
        <div className="st-tbl"><div className="st-th" style={{ gridTemplateColumns: "70px 90px 90px minmax(0,1fr) 90px" }}><span>Grade</span><span>From %</span><span>To %</span><span>Meaning</span><span>Points</span></div>
          {sc.grades.map((g: any, i: number) => (
            <div key={i} className="st-tr" style={{ "--i": i } as any}>
              <div><span className="st-lbl">Grade</span><input className="input" aria-label="Grade" value={g.grade} onChange={(e) => setG(i, { grade: e.target.value })} /></div>
              <div><span className="st-lbl">From %</span>{num(g.min, (x) => setG(i, { min: x }), "From")}</div>
              <div><span className="st-lbl">To %</span>{num(g.max, (x) => setG(i, { max: x }), "To")}</div>
              <div><span className="st-lbl">Meaning</span><input className="input" aria-label="Meaning" value={g.meaning} onChange={(e) => setG(i, { meaning: e.target.value })} /></div>
              <div><span className="st-lbl">Points</span>{num(g.points, (x) => setG(i, { points: x }), "Points")}</div></div>))}</div>
      </Section>
      <Section icon="grad" title="Divisions" hint="Sum of the best subjects' points; lower is better." h={130} i={1}>
        <div className="st-tbl"><div className="st-th" style={{ gridTemplateColumns: "70px 90px 90px minmax(0,1fr)" }}><span>Division</span><span>From</span><span>To</span><span>Meaning</span></div>
          {sc.divisions.map((d: any, i: number) => (
            <div key={i} className="st-tr dv" style={{ "--i": i } as any}>
              <div><span className="st-lbl">Division</span><input className="input" aria-label="Division" value={d.division} onChange={(e) => setD(i, { division: e.target.value })} /></div>
              <div><span className="st-lbl">From</span>{num(d.min, (x) => setD(i, { min: x }), "From")}</div>
              <div><span className="st-lbl">To</span>{num(d.max, (x) => setD(i, { max: x }), "To")}</div>
              <div><span className="st-lbl">Meaning</span><input className="input" aria-label="Meaning" value={d.meaning} onChange={(e) => setD(i, { meaning: e.target.value })} /></div></div>))}</div>
        <Row title="Best subjects counted" hint="How many of a student's best subjects make up the division." >
          <Stepper label="Best subjects counted" value={sc.subjects_counted} onChange={(n) => set({ ...sc, subjects_counted: n })} min={1} max={20} presets={[5, 7, 8]} />
        </Row>
        <div className="st-actions"><button type="button" className="btn" onClick={() => confirm("Put the NECTA defaults in the form? Nothing is saved until you press Save.") && set(clone(NECTA))}>Use NECTA defaults</button></div>
        <p className="muted small">Old published results keep the scale they were marked with.</p>
      </Section>
    </>
  );
}

function useRun(reload: () => void) {
  const [errs, setErrs] = useState<string[]>([]);
  const run = async (fn: () => Promise<any>, after?: () => void) => { setErrs([]); try { await fn(); after?.(); reload(); } catch (e: any) { setErrs(errorLines(e.data, e.message)); } };
  return { errs, run, note: errs.length > 0 ? <div className="card error" role="alert">{errs.map((e, i) => <p key={i}>⚠ {e}</p>)}</div> : null };
}
const Needle = ({ value, onChange, ph }: { value: string; onChange: (s: string) => void; ph: string }) => (
  <div className="st-search"><span><Icon n="eye" size={16} /></span><input className="input" type="search" placeholder={ph} aria-label={ph} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} /></div>
);

function ClassesSec() {
  const classes = useLoad(() => api<any[]>("/classes/"));
  const { run, note } = useRun(classes.reload);
  const [c, setC] = useState({ name: "", form_level: 1, stream: "" }), [q, setQ] = useState("");
  const hit = (t: string) => !q.trim() || q.trim().toLowerCase().split(/\s+/).every((w) => t.toLowerCase().includes(w));
  const list = (classes.data || []).filter((x: any) => hit(`${x.name} form ${x.form_level} ${x.stream || ""}`));
  const levels = [0, 1, 2, 3, 4].filter((l) => list.some((x: any) => x.form_level === l));
  return (
    <Section icon="layers" title="Classes" hint="These are the classes teachers, uploads and exams choose from." h={260} i={0}>
      {note}
      {(classes.data?.length || 0) > 8 && <Needle value={q} onChange={setQ} ph="Search classes" />}
      {classes.loading && !classes.data ? <Loading /> : list.length === 0 ? <p className="st-empty">No classes yet. Add the first one below.</p> : levels.map((l) => (
        <div key={l} className="st-group"><h3>{l === 0 ? "Pre-Form" : `Form ${l}`}</h3>
          <div className="st-chips">{list.filter((x: any) => x.form_level === l).map((x: any, i: number) => (
            <span key={x.id} className="st-chip" style={{ "--i": i } as any}>{x.name}{x.stream ? <small>· {x.stream}</small> : null}
              <button type="button" aria-label={`Delete ${x.name}`} onClick={() => confirm(`Delete ${x.name}?`) && run(() => api(`/classes/${x.id}/`, { method: "DELETE" }))}>×</button></span>))}</div></div>))}
      <div className="st-form">
        <label className="field"><span>Name</span><input className="input" placeholder="e.g. Form 1A" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
        <label className="field"><span>Form</span><select className="input" value={c.form_level} onChange={(e) => setC({ ...c, form_level: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 0 ? "Pre-Form" : `Form ${n}`}</option>)}</select></label>
        <label className="field"><span>Stream</span><input className="input" placeholder="A" value={c.stream} onChange={(e) => setC({ ...c, stream: e.target.value })} /></label>
        <button type="button" className="btn primary" disabled={!c.name.trim()} onClick={() => run(() => api("/classes/", { body: c }), () => setC({ name: "", form_level: c.form_level, stream: "" }))}><Icon n="plus" size={16} /> Add class</button>
      </div>
    </Section>
  );
}

function SubjectsSec() {
  const subjects = useLoad(() => api<any[]>("/subjects/"));
  const { run, note } = useRun(subjects.reload);
  const [sub, setSub] = useState({ name: "", language: "en" }), [q, setQ] = useState("");
  const hit = (t: string) => !q.trim() || q.trim().toLowerCase().split(/\s+/).every((w) => t.toLowerCase().includes(w));
  return (
    <Section icon="book" title="Subjects" hint="Switch practice on or off for each subject." h={280} i={0}>
      {note}
      {(subjects.data?.length || 0) > 8 && <Needle value={q} onChange={setQ} ph="Search subjects" />}
      {subjects.loading && !subjects.data ? <Loading /> : <PagedList as="div" className="" items={(subjects.data || []).filter((x: any) => hit(`${x.name} ${x.language === "sw" ? "kiswahili" : "english"}`))} size={10}
        render={(x: any, i?: number) => <div key={x.id} className="st-subj" style={{ "--i": i || 0 } as any}><span>{x.name}</span><span className="st-lang">{x.language === "sw" ? "Kiswahili" : "English"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: ".5rem" }}><small className="muted">Practice</small><Switch label={`Practice for ${x.name}`} on={!!x.practice_enabled} onChange={(b) => run(() => api(`/practice/subjects/${x.id}/toggle/`, { body: { enabled: b } }))} /></span></div>} />}
      <div className="st-form">
        <label className="field"><span>New subject</span><input className="input" value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} /></label>
        <label className="field"><span>Examined in</span><select className="input" value={sub.language} onChange={(e) => setSub({ ...sub, language: e.target.value })}><option value="en">English</option><option value="sw">Kiswahili</option></select></label>
        <button type="button" className="btn primary" disabled={!sub.name.trim()} onClick={() => run(() => api("/subjects/", { body: sub }), () => setSub({ name: "", language: sub.language }))}><Icon n="plus" size={16} /> Add subject</button>
      </div>
    </Section>
  );
}

function TermsSec() {
  const terms = useLoad(() => api<any[]>("/terms/")), years = useLoad(() => api<any[]>("/academic-years/"));
  const { run, note } = useRun(() => { terms.reload(); years.reload(); });
  const [yr, setYr] = useState(""), [tm, setTm] = useState({ year: "", name: "", start_date: "", end_date: "" });
  return (
    <Section icon="calendar" title="Academic years and terms" hint="Exams and reports are grouped by these." h={300} i={0}>
      {note}
      {(years.data || []).length === 0 ? <p className="st-empty">No academic year yet.</p> : (years.data || []).map((y: any, i: number) => (
        <div key={y.id} className="st-year" style={{ "--i": i } as any}><h3>{y.name} {y.is_current && <span className="st-lang" style={{ background: "var(--primary)", color: "var(--on-primary)" }}>current</span>}</h3>
          <div className="st-chips">{(terms.data || []).filter((t: any) => t.year === y.id).map((t: any) => <span key={t.id} className="st-chip">{t.name}</span>)}{!(terms.data || []).some((t: any) => t.year === y.id) && <span className="muted small">No terms yet</span>}</div></div>))}
      <div className="st-form">
        <label className="field"><span>New year</span><input className="input" placeholder="e.g. 2027" value={yr} onChange={(e) => setYr(e.target.value)} /></label>
        <button type="button" className="btn primary" disabled={!yr.trim()} onClick={() => run(() => api("/academic-years/", { body: { name: yr, is_current: !years.data?.length } }), () => setYr(""))}><Icon n="plus" size={16} /> Add year</button>
      </div>
      <div className="st-form">
        <label className="field"><span>Year</span><select className="input" value={tm.year} onChange={(e) => setTm({ ...tm, year: e.target.value })}><option value="">Choose…</option>{years.data?.map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
        <label className="field"><span>Term</span><input className="input" placeholder="Term 1" value={tm.name} onChange={(e) => setTm({ ...tm, name: e.target.value })} /></label>
        <label className="field"><span>Starts</span><input className="input" type="date" value={tm.start_date} onChange={(e) => setTm({ ...tm, start_date: e.target.value })} /></label>
        <label className="field"><span>Ends</span><input className="input" type="date" value={tm.end_date} onChange={(e) => setTm({ ...tm, end_date: e.target.value })} /></label>
        <button type="button" className="btn primary" disabled={!tm.year || !tm.name || !tm.start_date || !tm.end_date} onClick={() => run(() => api("/terms/", { body: { ...tm, year: Number(tm.year) } }), () => setTm({ year: "", name: "", start_date: "", end_date: "" }))}><Icon n="plus" size={16} /> Add term</button>
      </div>
    </Section>
  );
}
