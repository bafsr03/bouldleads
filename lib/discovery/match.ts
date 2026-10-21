import { BUSINESS_TYPES, type BizType } from "./categories";

// Is this the same business / the type we think it is? Shared by search (merging listings),
// the audit (matching a lead to its Google profile) and the profile repair script.

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SUFFIX = /\b(inc|llc|l l c|co|corp|corporation|company|ltd|pllc|lc|the)\b/g;
/** "Ross Automotive, Inc." → "ross automotive" */
export const coreName = (n: string) => norm(n).replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

/** Two business names share most of their words ("La Casita 420 - Smoke Shop" ~ "La Casita 420 Catálogo"). */
export function similarName(a: string, b: string) {
  const ta = new Set(norm(a).split(" ").filter((w) => w.length > 1));
  const tb = new Set(norm(b).split(" ").filter((w) => w.length > 1));
  if (!ta.size || !tb.size) return false;
  const common = [...ta].filter((w) => tb.has(w)).length;
  return common / Math.min(ta.size, tb.size) >= 0.6;
}

/** Within ~300 m. */
export const near = (a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }, d = 0.003) =>
  a.lat != null && a.lng != null && b.lat != null && b.lng != null && Math.abs(a.lat - b.lat) < d && Math.abs(a.lng - b.lng) < d;

// Google types and labels that say nothing about what a business does.
const GENERIC_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "store",
  "service",
  "services",
  "corporate_office",
  "food",
  "health",
  "finance",
  "premise",
  "local_business",
  "business",
]);
const isGenericLabel = (label: string) => GENERIC_TYPES.has(norm(label).replace(/ /g, "_"));

// Words too general to confirm a type from a business name ("Main Street Auto Service").
const STOP = new Set([
  "shop", "store", "stores", "service", "services", "company", "center", "centre", "contractor", "agency", "studio", "dealer",
  "repair", "school", "clinic", "house", "club", "room", "office", "parts", "auto", "car", "the", "and", "for", "home", "place",
]);
// Name words that confirm a type beyond its search terms.
const EXTRA_WORDS: Record<string, string[]> = {
  motorcycle: ["motorcycle", "powersport", "moto", "harley", "atv", "utv"],
  car_wash: ["detail", "wash"],
  second_hand: ["pawn", "thrift", "antique", "consign", "resale"],
  landscaping: ["landscap", "lawn", "yard", "garden", "curb"],
  builder: ["construction", "builder", "contracting", "remodel"],
  tyres: ["tire", "tyre"],
  car_repair: ["auto repair", "collision", "body", "mechanic", "diesel", "transmission"],
};

const wordsCache = new Map<string, string[]>();
function confirmWords(t: BizType): string[] {
  let w = wordsCache.get(t.id);
  if (!w) {
    const set = new Set<string>([...(t.names ?? []), ...(EXTRA_WORDS[t.id] ?? [])].map(norm));
    for (const q of t.google) {
      set.add(norm(q));
      for (const word of norm(q).split(" ")) if (word.length >= 4 && !STOP.has(word)) set.add(word);
    }
    w = [...set].filter(Boolean);
    wordsCache.set(t.id, w);
  }
  return w;
}

/** A name word starts with one of the type's keywords ("Max Detail" → detailing, but "Bicycle" ≠ "cycle"). */
export function nameFits(name: string, t: BizType) {
  const n = ` ${norm(name)}`;
  return confirmWords(t).some((k) => n.includes(` ${k}`));
}

export type CategoryCheck = { category: string | null; confirmed: boolean };
export type GoogleTypeInfo = { primaryType?: string | null; primaryTypeLabel?: string | null; types?: string[] | null };

const typeByLabel = (label: string | null | undefined) => (label ? BUSINESS_TYPES.find((t) => t.label === label) : undefined);
const typeByGoogle = (gtype: string) =>
  BUSINESS_TYPES.find((t) => t.gtypes?.includes(gtype)) ?? (gtype.endsWith("_restaurant") ? typeByLabel("Restaurants") : undefined);

/**
 * What a business really is. A Google search for "motorcycle dealer" also returns pawn shops that sell
 * motorcycles, so the search term alone isn't proof:
 *   1. Google's types include the searched type → confirmed
 *   2. Google's primary type is a different catalog type → that type
 *   3. The name says it ("The Max Detail" for car wash & detailing) → confirmed
 *   4. Google has a specific primary type we don't catalog ("General Contractor") → Google's label
 *   5. Otherwise the searched type, unconfirmed: check the profile on the call.
 */
export function resolveCategory(searched: string | null, name: string, g: GoogleTypeInfo): CategoryCheck {
  const t = typeByLabel(searched);
  const types = g.types ?? [];
  const primary = g.primaryType && !GENERIC_TYPES.has(g.primaryType) ? g.primaryType : null;
  if (t?.gtypes?.some((x) => types.includes(x))) return { category: t.label, confirmed: true };
  const other = primary ? typeByGoogle(primary) : undefined;
  if (other && other !== t) return { category: other.label, confirmed: true };
  if (t && nameFits(name, t)) return { category: t.label, confirmed: true };
  const label = g.primaryTypeLabel && !isGenericLabel(g.primaryTypeLabel) && primary ? g.primaryTypeLabel : null;
  if (label) return { category: label, confirmed: true };
  return { category: searched ?? g.primaryTypeLabel ?? null, confirmed: false };
}
