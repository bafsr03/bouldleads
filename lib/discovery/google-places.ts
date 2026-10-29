import { BUSINESS_TYPES, googleQueriesFor } from "./categories";
import { nonFitReason } from "./fit";
import { googleFields, textSearchPage, type GooglePlace } from "./google-api";
import { resolveCategory } from "./match";
import { normalizeWebsite, socialUrl, type BBox, type ContactMode, type DiscoveredBusiness, type SearchArea, areaBbox, quarter } from "./overpass";
import { sleep } from "./http";
import { exclusionLists } from "../settings";
import { excludedReason } from "../check/terms";

// Lead source: Google Places API (New) Text Search.
// Google returns at most 60 results (3 pages × 20) per query, so when a query fills all 60
// we split the area into quarters and search each one (up to 2 levels, 16 sub-areas).
// Every page is one billed request; see google-api.ts for the free-tier guard.

const MAX_DEPTH = 2;

// Places Google types as public bodies or institutions: never a Bould prospect.
const NOT_A_BUSINESS_TYPES = new Set([
  "hospital", "university", "school", "primary_school", "secondary_school", "local_government_office", "city_hall", "courthouse",
  "embassy", "police", "fire_station", "post_office", "church", "mosque", "synagogue", "hindu_temple", "library", "cemetery",
]);

function toBusiness(p: GooglePlace, term: string, typeLabel: string | null): DiscoveredBusiness {
  // Google sometimes sends an address part without "types" (seen in Lima): skip those.
  const comp = (type: string) => p.addressComponents?.find((c) => c.types?.includes(type))?.shortText ?? null;
  const name = p.displayName?.text ?? "Unknown";
  // The search term is a hint, not proof: Google returns pawn shops for "motorcycle dealer".
  const cat = resolveCategory(typeLabel, name, { primaryType: p.primaryType, primaryTypeLabel: p.primaryTypeDisplayName?.text, types: p.types });
  return {
    sourceId: p.id,
    name,
    category: cat.category ?? term,
    categoryConfirmed: cat.confirmed,
    address: p.formattedAddress ?? null,
    // UK addresses use "postal_town" rather than "locality".
    city: comp("locality") ?? comp("postal_town") ?? comp("sublocality") ?? comp("administrative_area_level_2"),
    countryCode: comp("country")?.toUpperCase() ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    website: normalizeWebsite(p.websiteUri),
    socialUrl: socialUrl(p.websiteUri),
    email: null,
    google: googleFields(p),
  };
}

// Gas stations, casinos, pawn shops…: not Bould prospects unless that's exactly what was searched (see fit.ts).
// Excluded categories (Settings: unions, churches, schools…, retail unless it's a retail search) never become leads.
const keep = (b: DiscoveredBusiness, mode: ContactMode, primaryType: string | undefined, searched: string | null | undefined, lists: { excluded: string[]; retail: string[] }) =>
  b.google?.status !== "CLOSED_PERMANENTLY" &&
  !excludedReason({ category: b.category, google_type: b.google?.type ?? null, primaryType }, lists) &&
  !(primaryType && NOT_A_BUSINESS_TYPES.has(primaryType)) &&
  !nonFitReason({ name: b.name, primaryType, googleLabel: b.google?.type, categoryId: BUSINESS_TYPES.find((t) => t.label === searched)?.id }) &&
  (mode === 0 || !!b.website || (mode === 2 && !!b.phone));

const inCircle = (area: SearchArea, b: DiscoveredBusiness) => {
  if (area.type !== "circle" || b.lat == null || b.lng == null) return true;
  const dLat = ((b.lat - area.lat) * Math.PI) / 180;
  const dLng = ((b.lng - area.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((area.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= area.radiusKm;
};

export async function googleSearch(
  area: SearchArea,
  selection: string[],
  contactMode: ContactMode,
  opts: { maxResults: number; isCancelled: () => boolean | Promise<boolean>; startTerm?: number; deadline?: number; countryCode?: string | null },
): Promise<{ businesses: DiscoveredBusiness[]; requests: number; nextTerm: number; done: boolean }> {
  // English first, then the country's own language (see local-terms.ts).
  const terms = googleQueriesFor(selection, opts.countryCode ?? null);
  const where = area.type === "place" ? ` in ${area.label.split(",").slice(0, 2).join(",")}` : "";
  const seen = new Map<string, DiscoveredBusiness>();
  const lists = await exclusionLists();
  let requests = 0;

  async function searchRect(term: { text: string; lang: string | null; type: string | null }, [s, w, n, e]: BBox, depth: number) {
    const rect = { low: { latitude: s, longitude: w }, high: { latitude: n, longitude: e } };
    let pageToken: string | undefined;
    let got = 0;
    for (let page = 0; page < 3; page++) {
      if ((await opts.isCancelled()) || seen.size >= opts.maxResults) return;
      const j = await textSearchPage(`${term.text}${where}`, rect, pageToken, term.lang);
      requests++;
      for (const p of j.places ?? []) {
        got++;
        const b = toBusiness(p, term.text, term.type);
        if (!seen.has(p.id) && keep(b, contactMode, p.primaryType, term.type, lists) && inCircle(area, b)) seen.set(p.id, b);
      }
      pageToken = j.nextPageToken;
      if (!pageToken) break;
      await sleep(1200); // page tokens need a moment to become valid
    }
    // A full 60 means Google cut the list off: look closer.
    if (got >= 60 && depth < MAX_DEPTH) for (const q of quarter([s, w, n, e])) await searchRect(term, q, depth + 1);
  }

  // One search term at a time; stop between terms when the time budget runs out (the caller resumes at nextTerm).
  let i = opts.startTerm ?? 0;
  for (; i < terms.length; i++) {
    if (i > (opts.startTerm ?? 0) && Date.now() > (opts.deadline ?? Infinity)) break;
    await searchRect(terms[i], areaBbox(area), 0);
  }
  return { businesses: [...seen.values()].slice(0, opts.maxResults), requests, nextTerm: i, done: i >= terms.length };
}
