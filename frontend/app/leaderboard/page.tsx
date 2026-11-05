"use client";
import { useState } from "react";
import { Pager, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import { ErrorNote, Loading, Tabs } from "@/components/ui";
import { AVATAR_EMOJI } from "@/lib/emoji";
import { useSession } from "@/lib/session";

/** SRS 5.6: class-level, weekly or all-time, ranks XP only, display names only, can be hidden. */
export default function Leaderboard() {
  const { t } = useSession();
  const [period, setPeriod] = useState<"weekly" | "all">("weekly");
  const pg = usePaged<any>("/gamification/leaderboard/", { period }, { size: 10, field: "entries" });
  const { data, error, loading, reload } = pg;
  const rows = pg.rows as any[];
  const podium = pg.page === 1 ? [2, 1, 3].map((r) => rows.find((e) => e.rank === r)).filter(Boolean) : [];
  const showPodium = podium.length === 3;
  const list = showPodium ? rows.filter((e) => e.rank > 3) : rows;
  return (
    <Shell title={t("leaderboard")}>
      <Tabs tabs={[["weekly", t("this_week")], ["all", t("all_time")]]} value={period} onChange={(k) => setPeriod(k as "weekly" | "all")} />
      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : !data.enabled ? <div className="card"><p className="muted">{data.message}</p></div> : (
        <>
          <p className="muted small">{t("leaderboard_note")}</p>
          {data.you.message && <p className="hint sx-you-msg">{data.you.message}</p>}
          {showPodium && (
            <ol className="sx-podium" aria-label={t("lb_podium")}>
              {podium.map((e: any) => (
                <li key={e.rank} className={`sx-pod r${e.rank} ${e.is_me ? "me" : ""}`}>
                  <span className="sx-pod-av" aria-hidden>{AVATAR_EMOJI[e.avatar] || "🙂"}<i>{["🥇", "🥈", "🥉"][e.rank - 1]}</i></span>
                  <b className="sx-pod-name">{e.name}{e.is_me ? ` (${t("you")})` : ""}</b>
                  <span className="small muted">{t("level_n", { n: e.level })}</span>
                  <b className="sx-pod-xp">{e.xp} XP</b>
                  <span className="sx-pod-step" aria-hidden><span>{e.rank}</span></span>
                </li>
              ))}
            </ol>
          )}
          <ol className="list card paged sx-lb" ref={pg.top as any} aria-busy={pg.busy || undefined}>
            {list.map((e: any) => (
              <li key={e.rank + e.name} className={`sx-lb-row ${e.is_me ? "me" : ""}`}>
                <span className="sx-rank">{e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : e.rank}</span>
                <span className="sx-lb-av" aria-hidden>{AVATAR_EMOJI[e.avatar] || "🙂"}</span>
                <span className="grow sx-lb-name"><b>{e.name}</b>{e.is_me ? <span className="pill sx-you">{t("you")}</span> : null}<br /><span className="small muted">{t("level_n", { n: e.level })}</span></span>
                <b className="sx-lb-xp">{e.xp} XP</b>
              </li>
            ))}
            {!rows.length && <li className="muted">{t("no_xp")}</li>}
          </ol>
          <Pager {...pg.pager} onSize={undefined} />
        </>
      )}
    </Shell>
  );
}
