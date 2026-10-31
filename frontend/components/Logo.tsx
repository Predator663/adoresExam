"use client";
import { CSSProperties } from "react";
import { initialOf, useBrand } from "@/lib/brand";

/** The school's logo (uploaded in Staff > Settings), on a white disc so it stays readable on dark menus and in every theme.
 *  A school that has not uploaded one yet gets a round badge with its first letter. */
export default function Logo({ size = 40, label }: { size?: number; label?: string }) {
  const b = useBrand();
  const s: CSSProperties = { width: size, height: size };
  const alt = label ? `${b.school} ${label}`.trim() : "";
  return (
    <span className="logo-img" style={s}>
      {b.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.logoUrl} width={size} height={size} alt={alt} aria-hidden={alt ? undefined : true} style={{ objectFit: "contain" }} />
      ) : (
        <span aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontWeight: 800, fontSize: size * 0.5, color: "#0b6b4f" }}>{initialOf(b)}</span>
      )}
    </span>
  );
}
