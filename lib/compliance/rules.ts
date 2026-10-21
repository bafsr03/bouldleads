// Country guidance for B2B cold email. This is practical guidance, not legal advice.

export type Rule = {
  level: "ok" | "caution" | "consent";
  law: string;
  summary: string;
};

const EU = new Set([
  "BE", "BG", "CZ", "DK", "EE", "IE", "GR", "ES", "FR", "HR", "IT", "CY", "LV", "LT", "LU", "HU", "MT", "NL", "PL",
  "PT", "RO", "SI", "SK", "FI", "SE", "IS", "LI", "NO",
]);

// Countries where B2B cold email effectively requires prior consent.
export const CONSENT_COUNTRIES = new Set(["DE", "AT"]);

export function ruleFor(countryCode: string | null | undefined): Rule {
  const cc = (countryCode ?? "").toUpperCase();
  if (cc === "US")
    return {
      level: "ok",
      law: "CAN-SPAM",
      summary: "Allowed. You need an honest subject line, your postal address and a working opt-out, honoured within 10 days.",
    };
  if (cc === "CA")
    return {
      level: "caution",
      law: "CASL",
      summary:
        "Only allowed under 'implied consent': the address must be conspicuously published, with no 'no spam' notice, and your offer must be relevant to their business role. Identify yourself and include an unsubscribe.",
    };
  if (cc === "GB")
    return {
      level: "caution",
      law: "UK GDPR / PECR",
      summary:
        "Allowed to corporate addresses (ltd/plc) under legitimate interest. Sole traders and partnerships need consent. Always offer an easy opt-out.",
    };
  if (CONSENT_COUNTRIES.has(cc))
    return {
      level: "consent",
      law: "UWG §7 / TKG",
      summary: "Cold email to businesses generally requires prior consent. These leads are blocked unless you enable them in Settings.",
    };
  if (EU.has(cc))
    return {
      level: "caution",
      law: "GDPR / ePrivacy",
      summary:
        "B2B outreach usually relies on legitimate interest. Use generic business addresses, keep it relevant, say where you found the address, and honour opt-outs. Rules vary by country.",
    };
  if (cc === "AU")
    return {
      level: "caution",
      law: "Spam Act 2003",
      summary: "Inferred consent applies only to conspicuously published business addresses relevant to your offer. You must include an unsubscribe.",
    };
  return {
    level: "caution",
    law: "Local law",
    summary: "Check local anti-spam rules. Always identify yourself, include your address, and honour opt-outs.",
  };
}
