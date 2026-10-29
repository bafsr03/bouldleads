import { BUSINESS_TYPES } from "../discovery/categories";
import { norm } from "../discovery/match";

// What a customer actually types into Google, and who isn't a customer at all (Lead Sourcing &
// Scoring Improvements, Oct 28 2026 §3.1–3.3). Pure functions: run-check.ts and the audit use them.

// ---------- State (§3.3: "Rochester" alone is Rochester, New York) ----------

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]));

/** "1200 Main St, Rochester, MN 55901, USA" → "MN". Only US addresses; null when there's no state in it. */
export function stateOf(address: string | null | undefined, countryCode?: string | null): string | null {
  if (!address || (countryCode && countryCode.toUpperCase() !== "US")) return null;
  const abbr = address.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/) ?? address.match(/,\s*([A-Z]{2})\s*(?:,|$)/);
  if (abbr && US_STATES[abbr[1]]) return abbr[1];
  for (const part of address.split(",").map((p) => p.trim().replace(/\s+\d{5}(-\d{4})?$/, "").toLowerCase())) {
    const s = STATE_BY_NAME.get(part);
    if (s) return s;
  }
  return null;
}

// ---------- Search phrase (§3.2: the trade a customer searches, never a category label) ----------

// Google category labels and business names → the phrase customers type. First match wins, so the
// specific trades come before the broad ones ("Basement waterproofing" before "contractor").
const PHRASES: [RegExp, string][] = [
  [/waterproof/, "basement waterproofing"],
  [/pressure wash|power wash|soft wash|house wash/, "pressure washing"],
  [/\bdecks?\b|deck build/, "deck builder"],
  [/roof/, "roofing contractor"],
  [/remodel|renovat|kitchen and bath|bathroom/, "remodeling contractor"],
  [/concrete|flatwork|cement/, "concrete contractor"],
  [/excavat/, "excavation contractor"],
  [/septic/, "septic service"],
  [/\bhvac\b|heating|air condition|furnace|\bcooling\b/, "hvac contractor"],
  [/plumb/, "plumber"],
  [/electric/, "electrician"],
  [/fenc/, "fence contractor"],
  [/gutter/, "gutter installation"],
  [/garage door|overhead door/, "garage door repair"],
  [/tree service|tree care|arborist|stump/, "tree service"],
  [/landscap|lawn care|lawn service/, "landscaping"],
  [/sprinkler|irrigation/, "sprinkler repair"],
  [/pest|extermin|termite/, "pest control"],
  [/painter|painting/, "painting contractor"],
  [/epoxy/, "epoxy flooring"],
  [/carpet clean|upholstery/, "carpet cleaning"],
  [/window clean/, "window cleaning"],
  [/junk|hauling/, "junk removal"],
  [/handyman/, "handyman"],
  [/locksmith/, "locksmith"],
  [/siding/, "siding contractor"],
  [/insulation/, "insulation contractor"],
  [/foundation repair/, "foundation repair"],
  [/general contractor|construction company|home builder|builder/, "general contractor"],
];

// Bigger-ticket trades are called first within a priority (§6).
export const BIG_TICKET = new Set([
  "roofing contractor", "remodeling contractor", "concrete contractor", "basement waterproofing", "hvac contractor", "plumber", "deck builder",
  "fence contractor", "excavation contractor", "septic service", "general contractor", "foundation repair", "siding contractor",
]);

const phraseIn = (text: string | null | undefined) => {
  if (!text) return null;
  const t = norm(text);
  return PHRASES.find(([re]) => re.test(t))?.[1] ?? null;
};

// Google labels that name a kind of place, not a service anyone searches for.
const NOT_A_SERVICE = /^(services?|store|point of interest|establishment|business|corporate office|association|organization|association \/ organization|non ?profit organization)$/i;

export type PhraseSource = "manual" | "google" | "name" | "category";
export type Phrase = { phrase: string; source: PhraseSource };

type PhraseRow = { name: string; category: string | null; google_type: string | null; category_confirmed?: number | null };

/**
 * The trade a customer would search for this lead: a category someone set by hand, then Google's own
 * label ("Pressure washing service"), then the business name ("Liebenow Waterproofing"), then the
 * catalog type it was found under. null = no real customer search: the check is skipped ("No check").
 */
export function searchPhrase(row: PhraseRow): Phrase | null {
  const t = BUSINESS_TYPES.find((x) => x.label === row.category);
  if (row.category_confirmed === 2) {
    const p = phraseIn(row.category) ?? t?.search ?? t?.google[0] ?? row.category?.toLowerCase() ?? null;
    if (p) return { phrase: p, source: "manual" };
  }
  const label = row.google_type && !NOT_A_SERVICE.test(row.google_type.trim()) ? row.google_type : null;
  const fromLabel = phraseIn(label);
  if (fromLabel) return { phrase: fromLabel, source: "google" };
  const fromName = phraseIn(row.name);
  if (fromName) return { phrase: fromName, source: "name" };
  // A catalog type only counts when something confirmed it: a search term alone is a guess.
  if (t && row.category_confirmed !== 0) return { phrase: t.search ?? t.google[0], source: "category" };
  // Google's own specific label for a trade we don't map ("Chimney sweep" → "chimney sweep").
  if (label) return { phrase: label.toLowerCase(), source: "google" };
  return null;
}

/**
 * The search the top-3 check runs: service + city + state ("basement waterproofing Rochester MN").
 * Outside the US it stays "service in city" (states aren't how people search there). null = no check.
 */
export function customerQuery(row: PhraseRow & { city: string | null; address: string | null; country_code: string | null }): string | null {
  const p = searchPhrase(row);
  if (!p || !row.city) return null;
  const us = !row.country_code || row.country_code.toUpperCase() === "US";
  if (!us) return `${p.phrase} in ${row.city}`;
  const state = stateOf(row.address, "US");
  return [p.phrase, row.city, state].filter(Boolean).join(" ");
}

// ---------- Not a customer (§3.1) ----------

/** Editable in Settings. Matched as whole words against Google's category label and type. */
export const DEFAULT_EXCLUDED = [
  "association", "organization", "union", "non-profit", "nonprofit", "foundation", "church", "place of worship", "temple", "mosque",
  "synagogue", "government", "city hall", "courthouse", "school", "university", "college", "club", "hospital", "library",
];
/** Retail and product categories: excluded unless the lead came from a retail search on purpose (a Shopify list). */
export const DEFAULT_EXCLUDED_RETAIL = ["clothing", "boutique", "store", "retail", "apparel", "gift shop", "outlet"];

const RETAIL_GROUPS = new Set(["retail", "smoke", "food"]);

const wordRe = (term: string) => new RegExp(`(^|[^a-z])${norm(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);

/**
 * "Excluded category: Labor union", or null. `google_type` is Google's label ("Labor union"),
 * `primaryType` its id ("non_profit_organization"). A lead found by a retail search keeps the retail terms.
 */
export function excludedReason(
  row: { category: string | null; google_type: string | null; primaryType?: string | null },
  lists: { excluded: string[]; retail: string[] },
): string | null {
  const t = BUSINESS_TYPES.find((x) => x.label === row.category);
  const retailSearch = !!t && RETAIL_GROUPS.has(t.group);
  const terms = [...lists.excluded, ...(retailSearch ? [] : lists.retail)].map((x) => x.trim()).filter(Boolean);
  const subjects = [row.google_type, row.primaryType?.replace(/_/g, " ")].filter((s): s is string => !!s).map(norm);
  for (const term of terms) {
    const re = wordRe(term);
    if (subjects.some((s) => re.test(s))) return `Excluded category: ${row.google_type ?? row.primaryType}`;
  }
  return null;
}
