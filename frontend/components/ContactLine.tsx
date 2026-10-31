"use client";
import { useSite } from "@/lib/brand";

/** The school's name and the contact details it entered in Staff > Settings (blank ones are left out). */
export default function ContactLine() {
  const s = useSite();
  return (
    <p>{s.school}{s.address ? `, ${s.address}` : ""}
      {(s.email || s.phone) && <br />}
      {s.email && <>E-mail: <a href={`mailto:${s.email}`}>{s.email}</a></>}
      {s.email && s.phone && " · "}
      {s.phone && <>Phone: <a href={`tel:${s.phone.replace(/\s/g, "")}`}>{s.phone}</a></>}
    </p>
  );
}
