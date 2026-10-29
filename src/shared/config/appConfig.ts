// Single source of truth for values that must be identical everywhere (Decision 7).
// Real company and support values are set HERE ONLY, before the first production release.
// The support email and phone below are placeholders.

const supportPhoneE164 = "+910000000000"; // placeholder (fictitious); stored as E.164

/** Display form of an E.164 number: Indian numbers as "+91 XXXXX XXXXX", others unchanged. */
function toPhoneDisplay(e164: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return india ? `+91 ${india[1]} ${india[2]}` : e164;
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

export const APP_CONFIG = deepFreeze({
  product: {
    name: "Explore Hills CRM",
  },
  company: {
    legalName: "Explore Hills", // confirm the registered legal name before production
  },
  support: {
    email: "support@example.com", // placeholder
    phoneE164: supportPhoneE164,
    phoneDisplay: toPhoneDisplay(supportPhoneE164),
    phoneTelHref: `tel:${supportPhoneE164}`,
  },
  locale: {
    businessTimezone: "Asia/Kolkata", // IANA name, never a fixed offset (Decision 6)
    locale: "en-IN",
    currency: "INR",
  },
});

export type AppConfig = typeof APP_CONFIG;
