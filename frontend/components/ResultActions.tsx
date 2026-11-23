"use client";
/* "What next?": the things a student can do with a result, as big tiles. */
import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import { useSession } from "@/lib/session";
import "./result-plus.css";

function Tile({ icon, title, sub, href, onClick, busy, tone }: { icon: string; title: string; sub: string; href?: string; onClick?: () => void; busy?: boolean; tone?: string }) {
  const inner: ReactNode = (
    <>
      <span className={`ra-ico ${tone || ""}`} aria-hidden><Icon n={icon as any} size={22} /></span>
      <span className="ra-txt"><b>{title}</b><small>{sub}</small></span>
      <span className="ra-go" aria-hidden><Icon n="arrow" size={16} /></span>
    </>
  );
  return href
    ? <Link href={href} className="ra-tile">{inner}</Link>
    : <button type="button" className="ra-tile" onClick={onClick} disabled={busy}>{inner}</button>;
}

export default function ResultActions({ id, hasFull, weak, onFull, onShare, onSlip, busy }: {
  id: number; hasFull: boolean; weak: string[]; onFull: () => void; onShare: () => void; onSlip: () => void; busy: boolean;
}) {
  const { t } = useSession();
  return (
    <section className="ra" aria-label={t("rs_next")}>
      <h2>{t("rs_next")}</h2>
      <div className="ra-grid">
        {hasFull && <Tile icon="file" tone="a" title={t("rv_tab_exam")} sub={t("rs_a_full_sub")} onClick={onFull} />}
        <Tile icon="check" tone="b" title={t("rs_a_review")} sub={t("rs_a_review_sub")} href={`/review/?id=${id}`} />
        <Tile icon="refresh" tone="c" title={t("rs_a_mistakes")} sub={t("rs_a_mistakes_sub")} href="/saved/" />
        {weak.length > 0 && <Tile icon="pencil" tone="d" title={t("practise_now")} sub={t("rs_a_practise_sub", { topic: weak[0] })} href="/practice/" />}
        <Tile icon="megaphone" tone="e" title={t("rs_a_share")} sub={t("rs_a_share_sub")} onClick={onShare} />
        <Tile icon="download" tone="f" title={t("download_slip")} sub={t("rs_a_slip_sub")} onClick={onSlip} busy={busy} />
      </div>
    </section>
  );
}
