"use client";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Cancelled, Progress, downloadExams, downloadFiles, downloadPractice, downloadResults, formatBytes, listPacks, removeKind, storageUsage } from "@/lib/offline";
import { Entry, Index, clearOfflineData, readIndex, supported } from "@/lib/offlineStore";
import { useSession } from "@/lib/session";
import { Bar } from "./ui";

type Job = { running?: boolean; p?: Progress; msg?: string; ok?: boolean };
type Subject = { id: number; name: string; available_questions: number; can_start: boolean };

type RowProps = {
  k: string; title: string; desc?: string; entry?: Entry; job: Job; when: (e: Entry) => string; t: (k: string, p?: any) => string;
  onGet: () => void; onRemove: () => void; onCancel: () => void; files?: boolean; disabled?: boolean; note?: ReactNode;
};

function Row({ title, desc, entry, job: j, when, t, onGet, onRemove, onCancel, files, disabled, note }: RowProps) {
  const p = j.p, pct = Math.round((p?.fraction || 0) * 100);
  return (
    <div className="off-row">
      <div className="off-main">
        <b>{title}</b>
        {desc && <span className="muted small">{desc}</span>}
        {note}
        {j.running && p ? (
          <>
            <Bar value={pct} label={title} />
            <span className="small" role="status">{t("off_working", { p: pct })}{p.total ? ` · ${t(files ? "off_files_n" : "off_items_n", { a: p.done, b: p.total, size: formatBytes(p.bytes) })}` : ""}</span>
          </>
        ) : j.msg ? <span className={`small ${j.ok ? "ok" : "no"}`} role="status">{j.msg}</span>
          : entry ? <span className="small ok">✓ {t("off_saved", { when: when(entry), size: formatBytes(entry.bytes) })}</span>
          : <span className="muted small">{t("off_none")}</span>}
      </div>
      <div className="off-act">
        {j.running ? <button className="btn" onClick={onCancel}>{t("off_cancel")}</button> : (
          <>
            <button className="btn primary" disabled={disabled} onClick={onGet}>{entry ? t("off_update") : t("off_download")}</button>
            {entry && <button className="btn" onClick={onRemove}>{t("off_remove")}</button>}
          </>
        )}
      </div>
    </div>
  );
}

/** Settings > Offline use. Every download shows true progress: bytes inside a count of files, questions or results. */
export default function OfflineManager() {
  const { t, user, lang } = useSession();
  const student = user?.role === "student";
  const [idx, setIdx] = useState<Index | null>(null), [jobs, setJobs] = useState<Record<string, Job>>({});
  const [subjects, setSubjects] = useState<Subject[] | null>(null), [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const ctl = useRef<Record<string, AbortController>>({});
  const refresh = useCallback(() => { setIdx(readIndex()); storageUsage().then(setUsage); }, []);
  const setJob = (k: string, j: Job) => setJobs((x) => ({ ...x, [k]: j }));

  useEffect(() => {
    refresh();
    if (student) api<Subject[]>("/practice/subjects/").then(setSubjects).catch(() => setSubjects(null));
    return () => Object.values(ctl.current).forEach((a) => a.abort());
  }, [student, refresh]);

  if (!supported()) return <p className="muted small">{t("off_unsupported")}</p>;

  async function run(key: string, fn: (report: (p: Progress) => void, signal: AbortSignal) => Promise<void>) {
    if (!navigator.onLine) return setJob(key, { msg: t("off_need_net") });
    const ac = new AbortController(); ctl.current[key] = ac;
    setJob(key, { running: true, p: { fraction: 0, done: 0, total: 0, bytes: 0 } });
    try {
      await fn((p) => setJob(key, { running: true, p }), ac.signal);
      setJob(key, { msg: t("off_done"), ok: true });
    } catch (e: any) {
      setJob(key, { msg: e instanceof Cancelled ? t("off_cancelled") : t("off_failed", { m: e?.message || "" }) });
    } finally { delete ctl.current[key]; refresh(); }
  }
  const when = (e: Entry) => new Date(e.at).toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB", { day: "numeric", month: "short" });

  const common = (k: string) => ({ k, job: jobs[k] || {}, when, t, onCancel: () => ctl.current[k]?.abort() });
  const drop = async (k: string, fn: () => Promise<void>) => { await fn(); setJobs((x) => ({ ...x, [k]: {} })); refresh(); };
  const busy = Object.values(jobs).some((j) => j.running);
  const packs = listPacks();
  const startable = (subjects || []).filter((s) => s.can_start);
  async function all() {
    await run("files", (r, s) => downloadFiles(r, s));
    if (!student) return;
    await run("exams", (r, s) => downloadExams(r, s));
    await run("results", (r, s) => downloadResults(r, s));
    for (const s of startable) await run(`p${s.id}`, (r, sig) => downloadPractice(s.id, s.name, r, sig));
  }
  const reasonText = (s: Subject) => s.can_start ? undefined : t("not_enough");

  return (
    <div className="off">
      <p className="muted">{t("off_intro")}</p>
      <Row {...common("files")} files title={t("off_files")} desc={t("off_files_d")} entry={idx?.files} onGet={() => run("files", (r, s) => downloadFiles(r, s))} onRemove={() => drop("files", () => removeKind("files"))} />
      {student ? (
        <>
          <Row {...common("exams")} title={t("off_exams")} desc={t("off_exams_d")} entry={idx?.exams} onGet={() => run("exams", (r, s) => downloadExams(r, s))} onRemove={() => drop("exams", () => removeKind("exams"))} />
          <Row {...common("results")} title={t("off_results")} desc={t("off_results_d")} entry={idx?.results} onGet={() => run("results", (r, s) => downloadResults(r, s))} onRemove={() => drop("results", () => removeKind("results"))} />
          <h3 style={{ marginTop: "1rem" }}>{t("off_practice")}</h3>
          <p className="muted small">{t("off_practice_d")}</p>
          {(subjects || []).map((s) => {
            const pk = idx?.practice?.[String(s.id)];
            return <Row key={s.id} {...common(`p${s.id}`)} title={s.name} desc={t("n_questions_available", { n: s.available_questions })} entry={pk} disabled={!s.can_start}
              note={reasonText(s) ? <span className="small no">{reasonText(s)}</span> : undefined}
              onGet={() => run(`p${s.id}`, (r, sig) => downloadPractice(s.id, s.name, r, sig))} onRemove={() => drop(`p${s.id}`, () => removeKind("practice", String(s.id)))} />;
          })}
          {packs.filter((p) => !(subjects || []).some((s) => String(s.id) === p.id)).map((p) => (
            <Row key={p.id} {...common(`p${p.id}`)} title={p.entry.name} entry={p.entry} disabled onGet={() => {}} onRemove={() => drop(`p${p.id}`, () => removeKind("practice", p.id))} />
          ))}
          {subjects && !subjects.length && <p className="muted small">{t("off_no_subjects")}</p>}
          <p className="hint">{t("off_exam_note")}</p>
        </>
      ) : <p className="muted small">{t("off_not_student")}</p>}
      <div className="off-foot">
        <button className="btn primary big" disabled={busy} onClick={all}>⬇ {t("off_all")}</button>
        <button className="btn danger" disabled={busy} onClick={async () => { await removeKind("files"); await clearOfflineData(); setJobs({}); refresh(); }}>{t("off_remove_all")}</button>
      </div>
      {usage && <p className="muted small">{t("off_storage", { used: formatBytes(usage.used), quota: formatBytes(usage.quota) })}</p>}
    </div>
  );
}
