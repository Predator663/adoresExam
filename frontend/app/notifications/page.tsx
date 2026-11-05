"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import { ErrorNote, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import Icon from "@/components/Icon";
import { ago } from "@/lib/clock";
import { useSession } from "@/lib/session";

/** NOT-01: in-app notifications (upcoming exams, exam start, results ready, password changes, badges). */
export default function Notifications() {
  const { t, lang } = useSession();
  const ico = (k: string) => (k === "results_ready" || k === "results" ? "chart" : k === "exam_reminder" || k === "exam_start" ? "calendar" : k === "badge" || k === "level_up" ? "medal" : k === "password" ? "key" : "bell");
  const pg = usePaged<any>("/notifications/", {}, { size: 20 });
  const { data, error, loading, reload } = pg;
  useEffect(() => { if (data?.unread) api("/notifications/read/", { body: { all: true } }).then(() => window.dispatchEvent(new Event("amani:notifications"))).catch(() => {}); }, [data]);
  const link = (n: any) => n.kind === "results_ready" || n.kind === "results" ? "/results/" : n.data?.attempt_id ? `/result/?id=${n.data.attempt_id}`
    : n.kind === "exam_reminder" || n.kind === "exam_start" ? (n.data?.exam_id ? `/exam/?id=${n.data.exam_id}` : null)
    : n.kind === "badge" || n.kind === "level_up" ? "/badges/" : null;
  return (
    <Shell title={t("notifications")}>
      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : !pg.rows.length ? <div className="card"><p className="muted">{t("no_notifications")}</p></div> : <><div ref={pg.top} className="paged" aria-busy={pg.busy || undefined}>{pg.rows.map((n) => {
        const href = link(n);
        const body = <><span className="sx-nico" aria-hidden><Icon n={ico(n.kind)} size={20} /></span><span className="sx-nbody"><b>{n.title}{!n.read && <span className="pill sx-new">{t("unread_label")}</span>}</b><span className="sx-ntext">{n.body}</span><span className="small muted">{ago(n.created_at, lang)}</span></span></>;
        return href ? <Link key={n.id} href={href} className={`card sx-notif ${n.read ? "" : "unread"}`} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : <div key={n.id} className={`card sx-notif ${n.read ? "" : "unread"}`}>{body}</div>;
      })}</div><Pager {...pg.pager} /></>}
    </Shell>
  );
}
