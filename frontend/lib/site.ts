/** The operator (developer) of this system. Written here once: the About page card and the footer credit read it. */
export const OPERATOR = {
  id: "operator",
  name: "Mr. Mhechela",
  callsign: "Kratos",
  email: "predatora186@gmail.com",
  phone: "0693 696 717",
  phoneTel: "+255693696717",              // the same number in international form, for the tap-to-call link
  avatar: "/operator/cratos.jpg",
  avatarAlt: "Cratos: a samurai in silhouette against a glowing blue moon",
};

/** The second person credited next to the operator. No photo yet: the footer and card show his initial. Add one at
 *  public/operator/pamtech.jpg and set avatar below to use it. */
export const PARTNER = {
  id: "pamtech",
  name: "Mr. Pascal",
  callsign: "Pamtech",
  email: "pniniku@gmail.com",
  phone: "0768 777 166",
  phoneTel: "+255768777166",
  avatar: "",
  avatarAlt: "",
};
export const OPERATORS = [OPERATOR, PARTNER];

/** Edit these once: they appear in the footer, the About page and the legal pages. */
export const SITE = {
  school: "the school",      // only until the school's own name has loaded (Staff > Settings), see lib/brand.tsx
  app: "Online Exams",
  version: "1.0",
  year: 2026,
  updated: "28 October 2026",
  email: "",                            // the school's own contact details come from Staff > Settings
  phone: "",
  address: "",
  developer: `${OPERATOR.name} (call sign ${OPERATOR.callsign})`,   // the personal credit on the About page
  retention: "while the student is enrolled and for the period the school keeps its academic records",
};
