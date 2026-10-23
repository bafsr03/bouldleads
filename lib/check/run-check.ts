import { db, now } from "../db";
import { BUSINESS_TYPES } from "../discovery/categories";
import { localLang } from "../discovery/local-terms";
import { cached, googleKey, topResults, uncache, type RankedPlace } from "../discovery/google-api";
import { geocode } from "../discovery/nominatim";
import { mobilePageSpeed, type SiteFacts } from "../audit/site";
import { serviceQuery } from "../audit/run-audit";
import type { AuditResult } from "../audit/score";
import { SKIP, callPriority, diagnose, rankOf, skipReason, topCategory, type Competitor, type Diagnosis, type LeadFacts, type SiteFlags } from "./diagnose";

// Runs the top-3 check for one lead (Competitor Check spec v2 §3.1) and saves it on the lead.
// Called after every audit (so every pulled lead gets one), by the Re-run button, and by intake
// for site and Meta leads. A few cents per lead: the search is cached 7 days per search + area,
// and many leads in one city share it.

const DAY = 86_400_000;
export const CHECK_MAX_AGE = 7 * DAY;
const RADIUS_M = 15_000; // spec: "start with ~15 km"

/** Trades with a slow season: called after year-round ones within the same priority (spec §3.4). */
export const SEASONAL = new Set(["roofer", "painter", "landscaping", "concrete", "fencing", "tree_service", "irrigation", "window_cleaning", "gutters"]);

export type TopCheck = {
  v: 1;
  at: number;
  query: string;
  city: string | null;
  rank: number | null;
  lead: LeadFacts & { name: string };
  top: Competitor[]; // up to 20, in Google's order
  diagnosis: Diagnosis;
  flags: SiteFlags;
  marketKm: number | null;
  skip: string | null;
  priority: number;
  seasonal: boolean;
};

type CheckRow = {
  id: number;
  name: string;
  category: string | null;
  city: string | null;
  address: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  google_place_id: string | null;
  google_type: string | null;
  google_types: string | null;
  google_primary_type: string | null;
  category_confirmed: number | null;
  rating: number | null;
  review_count: number | null;
  business_status: string | null;
  audit: string | null;
  check_query: string | null;
  top_check: string | null;
  checked_at: number | null;
  lead_source: string | null;
};

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/** The centre of a city, cached for 90 days (Nominatim, free; 1 request a second). */
export async function cityCentre(city: string, countryCode?: string | null): Promise<{ lat: number; lng: number } | null> {
  const q = [city, countryCode].filter(Boolean).join(", ");
  try {
    return await cached(`geo:${q.toLowerCase()}`, 90 * DAY, async () => {
      const p = (await geocode(q))[0];
      return p ? { lat: p.lat, lng: p.lng } : null;
    });
  } catch {
    return null;
  }
}

/** Website flags for the call (spec §3.2 "Add" rows). PageSpeed is fetched only when it decides the call order. */
export async function siteFlags(row: Pick<CheckRow, "website">, site: SiteFacts | null, needSpeed: boolean): Promise<SiteFlags> {
  const own = !!site && !site.socialOnly && !site.directory;
  const dead = !!site && (site.error === "down" || site.error === "parked");
  const noSite = !row.website || !own || dead;
  const measured = own && site!.reachable;
  let mobileScore = site?.pageSpeed ?? null;
  if (needSpeed && measured && mobileScore == null && site!.url) {
    const url = site!.url;
    mobileScore = await cached(`psi:${url}`, 14 * DAY, async () => mobilePageSpeed(url, await googleKey())).catch(() => null);
  }
  return {
    noSite,
    slowMobile: !noSite && mobileScore != null && mobileScore < 50,
    noCall: measured && !site!.tapToCall && !site!.whatsapp,
    noForm: measured && !site!.form && !site!.booking && !site!.ecommerce && !site!.formMaybe,
    mobileScore,
  };
}

const typeFor = (row: Pick<CheckRow, "category">) => BUSINESS_TYPES.find((t) => t.label === row.category);

/** The lead's own Google type id: stored from its profile, else Google's first listed type. */
function leadPrimaryType(row: CheckRow): string | null {
  if (row.google_primary_type) return row.google_primary_type;
  try {
    return row.google_types ? ((JSON.parse(row.google_types) as string[])[0] ?? null) : null;
  } catch {
    return null;
  }
}

export function storedCheck(row: { top_check: string | null }): TopCheck | null {
  try {
    return row.top_check ? (JSON.parse(row.top_check) as TopCheck) : null;
  } catch {
    return null;
  }
}

/**
 * Run (or reuse) the check. `query` replaces the search term (saved on the lead); `force` skips
 * both caches (Re-run); `site` is a fresh website check from the audit that is running now.
 */
export async function runTopCheck(id: number, opts: { query?: string | null; force?: boolean; site?: SiteFacts | null } = {}): Promise<TopCheck | null> {
  const row = await db.get<CheckRow>("SELECT * FROM businesses WHERE id = ?", id);
  if (!row) return null;
  const prev = storedCheck(row);
  const query = (opts.query?.trim() || row.check_query || serviceQuery(row) || "").trim();
  if (!query) return null;
  if (!opts.force && !opts.site && prev && prev.query === query && row.checked_at && now() - row.checked_at < CHECK_MAX_AGE) return prev;
  if (!(await googleKey())) return null;

  // Search from the business; a lead with no map location (not on Google) is searched from its city.
  const centre = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : row.city ? await cityCentre(row.city, row.country_code) : null;
  if (!centre) return null;

  const key = `top20:${query.toLowerCase()}:${centre.lat.toFixed(2)},${centre.lng.toFixed(2)}`;
  if (opts.force) await uncache(key);
  const places = await cached<RankedPlace[]>(key, CHECK_MAX_AGE, () => topResults(query, centre.lat, centre.lng, RADIUS_M, localLang(row.country_code)));
  const top: Competitor[] = places.map(({ id: pid, name, rating, reviews, category, primaryType }) => ({ id: pid, name, rating, reviews, category, primaryType }));

  // The search result is fresher than the stored profile when the lead is in it.
  const me = row.google_place_id ? places.find((p) => p.id === row.google_place_id) : undefined;
  const lead: TopCheck["lead"] = {
    name: me?.name || row.name,
    placeId: row.google_place_id,
    status: me?.status ?? row.business_status,
    rating: me?.rating ?? row.rating,
    reviews: me?.reviews ?? row.review_count,
    category: me?.category ?? row.google_type,
    primaryType: me?.primaryType ?? leadPrimaryType(row),
  };
  const rank = rankOf(lead.placeId, top);
  const diagnosis = diagnose(lead, top, query, row.city);

  const audit = row.audit ? (JSON.parse(row.audit) as AuditResult) : null;
  const site = opts.site !== undefined ? opts.site : (audit?.inputs.site ?? null);
  // PageSpeed only matters when it decides between "call 2nd" and "skip" (top 3 already).
  const flags = await siteFlags(row, site, diagnosis.case === "G");

  let marketKm: number | null = null;
  if (row.lat != null && row.lng != null && row.city) {
    const c = await cityCentre(row.city, row.country_code);
    if (c) marketKm = Math.round(km({ lat: row.lat, lng: row.lng }, c) * 10) / 10;
  }

  const skip = skipReason({ ...lead, address: row.address }, !!row.lead_source);
  const priority = skip ? SKIP : callPriority(diagnosis.case, flags);
  const seasonal = SEASONAL.has(typeFor(row)?.id ?? "");

  const check: TopCheck = { v: 1, at: now(), query, city: row.city, rank, lead, top: top.slice(0, 20), diagnosis, flags, marketKm, skip, priority, seasonal };
  await db.run(
    `UPDATE businesses SET check_query = ?, top_check = ?, checked_at = ?, check_case = ?, check_priority = ?, seasonal = ? WHERE id = ?`,
    query,
    JSON.stringify(check),
    check.at,
    diagnosis.case,
    priority,
    seasonal ? 1 : 0,
    id,
  );
  return check;
}

/** What the audit's scoring needs from a check (lib/audit/score.ts GoogleFacts.top3). */
export function top3Summary(c: TopCheck) {
  const t3 = c.top.slice(0, 3);
  const reviews = t3.map((x) => x.reviews ?? 0);
  const tc = topCategory(t3);
  return {
    minReviews: reviews.length ? Math.min(...reviews) : null,
    maxReviews: reviews.length ? Math.max(...reviews) : null,
    // Unknown on either side counts as a match: only a clear mismatch fails.
    categoryMatch: !tc.primaryType || !c.lead.primaryType || tc.primaryType === c.lead.primaryType,
    category: tc.category,
  };
}
