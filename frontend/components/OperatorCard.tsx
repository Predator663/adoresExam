import { OPERATOR } from "@/lib/site";

type Person = { id: string; name: string; callsign: string; email: string; phone: string; phoneTel: string; avatar: string; avatarAlt: string };

/** Operator card: avatar, name, call sign, e-mail, phone. Used on the About page; the look is strongest in the Modern Warfare III theme. */
export default function OperatorCard({ who = OPERATOR, tag = "Operator" }: { who?: Person; tag?: string }) {
  return (
    <section className="op-card" id={who.id} aria-label={tag}>
      <div className={`op-frame ${who.avatar ? "" : "initial"}`}>
        {who.avatar
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={who.avatar} alt={who.avatarAlt} width={120} height={120} loading="lazy" />
          : <span aria-hidden>{who.name.replace(/^Mr\.?\s*/, "").charAt(0)}</span>}
      </div>
      <div className="op-info">
        <span className="op-tag">{tag}</span>
        <h3 className="op-name">{who.name}</h3>
        <p className="op-call">Call sign <b>{who.callsign.toUpperCase()}</b></p>
        <p className="op-links">
          <a href={`mailto:${who.email}`}>{who.email}</a>
          <a href={`tel:${who.phoneTel}`}>{who.phone}</a>
        </p>
      </div>
    </section>
  );
}
