"use client";
import { useState } from "react";
import { Pager, useClientPage, usePaged } from "@/components/Pager";
import Shell from "@/components/Shell";
import { Ring } from "@/components/student";
import { Bar, ErrorNote, Loading, Tabs, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { ProfilePhoto } from "@/components/PhotoPicker";
import { AVATAR_EMOJI, BADGE_EMOJI, TIER_MARK } from "@/lib/emoji";
import { useSession } from "@/lib/session";

/** SRS 5.4 / 5.6: badge cabinet with what to aim for next, XP history, profile. */
export default function Badges() {
  const { t } = useSession();
  const b = useLoad(() => api<any[]>("/gamification/badges/"));
  const xp = usePaged<any>("/gamification/xp/", {}, { size: 10 });
  const [filter, setFilter] = useState("all");
  const all = b.data || [];
  const shown = all.filter((x) => filter === "all" || (filter === "earned" ? x.earned : !x.earned));
  const bp = useClientPage(shown, 12, filter);
  const me = useLoad(() => api<any>("/gamification/me/"));
  const earned = all.filter((x) => x.earned).length;
  return (
    <Shell title={t("nav_badges")}>
      {me.data && (
        <div className="card sx-profile">
          <Ring value={me.data.level.progress_percent} size={76} stroke={5} label={t("xp_progress")}><ProfilePhoto photo={me.data.profile.photo} fallback={AVATAR_EMOJI[me.data.profile.avatar] || "🦉"} size={62} className="sx-hero-avatar" /></Ring>
          <div className="grow"><b className="sx-profile-name">{me.data.profile.display_name || t("my_profile")}</b><br /><span className="muted">{t("level_n", { n: me.data.level.level })} · {me.data.level.name} · {me.data.xp} XP</span>
            {b.data && <p className="small sx-earned-line">{t("badges_earned_of", { a: earned, b: all.length })}</p>}</div>
        </div>
      )}
      {b.loading ? <Loading /> : b.error ? <ErrorNote error={b.error} retry={b.reload} /> : (
        <>
          <Tabs tabs={[["all", t("filter_all")], ["earned", t("filter_earned")], ["progress", t("filter_progress")]]} value={filter} onChange={setFilter} />
          {!bp.rows.length ? <div className="card"><p className="muted">{t("no_badges_here")}</p></div> : (
            <div className="sx-badges" ref={bp.top}>
              {bp.rows.map((x, i) => (
                <div key={`${x.code}-${i}`} className={`badge-tile sx-badge tier-${x.tier} ${x.earned ? "" : "locked"}`}>
                  <span className="sx-badge-em" aria-hidden><span className="em">{BADGE_EMOJI[x.code] || "🏅"}</span></span>
                  <b>{x.name}</b>{x.subject && <div className="small muted">{x.subject}</div>}
                  <div className="small sx-tier">{x.earned ? `${TIER_MARK[x.tier] || ""} ${x.tier_label}` : `🔒 ${t("locked")}`}</div>
                  <p className="small muted">{x.description}</p>
                  {x.next_target ? <><div className="small">{x.progress}/{x.next_target} {x.unit}</div><Bar value={x.next_target > 0 ? (x.progress / x.next_target) * 100 : 0} label={x.name} /></> : <div className="small ok">{t("max_tier")}</div>}
                </div>
              ))}
            </div>
          )}
          <Pager {...bp.pager} />
        </>
      )}
      <h2>{t("xp_history")}</h2>
      {xp.data && <><ul className="list card paged" ref={xp.top as any} aria-busy={xp.busy || undefined}>{xp.rows.map((e: any, i: number) => <li key={i} className="row"><span className="grow">{e.label}</span><b className="sx-xp">+{e.points}</b></li>)}{!xp.rows.length && <li className="muted">{t("no_xp")}</li>}</ul><Pager {...xp.pager} onSize={undefined} /></>}
    </Shell>
  );
}
