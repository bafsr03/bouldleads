import { db, now } from "../db";
import { BUSINESS_TYPES } from "../discovery/categories";
import { localLang } from "../discovery/local-terms";
import { cached, googleKey, topResults, uncache, type RankedPlace } from "../discovery/google-api";
import { geocode } from "../discovery/nominatim";
import { mobilePageSpeed, type SiteFacts } from "../audit/site";
import type { AuditResult } from "../audit/score";
import { exclusionLists } from "../settings";
import { SKIP, callPriority, diagnose, rankOf, skipReason, topCategory, type Competitor, type Diagnosis, type LeadFacts, type SiteFlags } from "./diagnose";
import { BIG_TICKET, customerQuery, excludedReason, searchPhrase, stateOf } from "./terms";
import { gradeSite, leadServiceLine, locationMismatch, payingFor, profileLinkProblem, type SiteGrade } from "./site-grade";

// Runs the top-3 check for one lead (Competitor Check spec v2 §3.1) and saves it on the lead.
// Lead Sourcing & Scoring Improvements (Oct 28 2026): the search is "service city state", excluded
// categories and leads with no real customer search get no check, and the call order uses the
// website grade, location mismatch and whether they already pay for marketing.
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
  // Oct 29 2026 additions (optional: checks saved before then lack them)
  grade?: SiteGrade | null;
  findings?: string[]; // extra card lines: location mismatch, the profile link, lead services, builder
  builder?: string | null;
  leadServices?: string[];
  bigTicket?: boolean;
  revisitAt?: number | null; // top 3 with a strong site: call back after this
};

export const REVISIT = 182 * DAY; // "Skip with a 6-month callback date"

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
  check_query_manual: number | null;
  email: string | null;
  found_site: string | null;
  found_site_how: string | null;
};

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/**
 * The centre of a city, cached for 90 days (Nominatim, free; 1 request a second). In the US the state
 * goes in the lookup: "Rochester, US" is Rochester, New York (1,199 km from Rochester, MN).
 */
export async function cityCentre(city: string, countryCode?: string | null, state?: string | null): Promise<{ lat: number; lng: number } | null> {
  const q = [city, state, countryCode].filter(Boolean).join(", ");
  try {
    return await cached(`geo:${q.toLowerCase()}`, 90 * DAY, async () => {
      const p = (await geocode(q))[0];
      return p ? { lat: p.lat, lng: p.lng } : null;
    });
  } catch {
    return null;
  }
}

/**
 * Website flags for the call (spec §3.2 "Add" rows) and the site grade. A site we haven't checked yet
 * (intake runs before the audit) isn't "no website": only a missing link or a dead, social or
 * directory page is. PageSpeed is measured for every site we can read (cached 14 days).
 */
export async function siteFlags(row: Pick<CheckRow, "website">, site: SiteFacts | null, needSpeed: boolean, grade: SiteGrade | null = null): Promise<SiteFlags> {
  const own = !!site && !site.socialOnly && !site.directory;
  const dead = !!site && (site.error === "down" || site.error === "parked");
  const noSite = site ? !own || dead : !row.website;
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
    grade: noSite ? null : (grade?.grade ?? null),
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

/** Why a lead gets no check: "Excluded category: …" or no real customer search. Saved as check_case 'none'. */
async function saveNoCheck(id: number, note: string, skip: boolean) {
  await db.run(
    "UPDATE businesses SET top_check = NULL, checked_at = ?, check_case = 'none', check_priority = ?, check_note = ? WHERE id = ?",
    now(),
    skip ? SKIP : null,
    note,
    id,
  );
}

/**
 * Run (or reuse) the check. `query` replaces the search term (saved on the lead, and kept until someone
 * clears it); `force` skips both caches (Re-run); `site` is a fresh website check from the running audit.
 */
export async function runTopCheck(id: number, opts: { query?: string | null; force?: boolean; site?: SiteFacts | null } = {}): Promise<TopCheck | null> {
  const row = await db.get<CheckRow>("SELECT * FROM businesses WHERE id = ?", id);
  if (!row) return null;
  const prev = storedCheck(row);
  const inbound = !!row.lead_source;

  // §3.1: not a customer (a union, a church…). Inbound leads asked us, so they're always checked.
  const excluded = inbound ? null : excludedReason({ category: row.category, google_type: row.google_type, primaryType: leadPrimaryType(row) }, await exclusionLists());
  if (excluded && !opts.query) {
    await saveNoCheck(id, excluded, true);
    return null;
  }

  // §3.2: the search a customer types, "basement waterproofing Rochester MN". A search typed on the card
  // (or given on the site form) wins until it's cleared; an old automatic one is rebuilt.
  const auto = customerQuery(row);
  const typed = opts.query?.trim() || null;
  const query = (typed || (row.check_query_manual ? row.check_query : null) || auto || "").trim();
  const manual = typed ? (typed !== auto ? 1 : 0) : (row.check_query_manual ?? 0);
  if (!query) {
    await saveNoCheck(id, "No check: no customer search for this category. Type one on the card to run it.", false);
    return null;
  }
  if (!opts.force && !opts.site && prev && prev.query === query && row.checked_at && now() - row.checked_at < CHECK_MAX_AGE) return prev;
  if (!(await googleKey())) return null;

  const state = stateOf(row.address, row.country_code);
  // Search from the business; a lead with no map location (not on Google) is searched from its city.
  const centre = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : row.city ? await cityCentre(row.city, row.country_code, state) : null;
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
  const phrase = searchPhrase(row);
  // Case B needs the search to be for a trade they offer: true for a search built from what they are.
  const diagnosis = diagnose(lead, top, query, row.city, { offersService: !!phrase || !!manual });

  const audit = row.audit ? (JSON.parse(row.audit) as AuditResult) : null;
  const site = opts.site !== undefined ? opts.site : (audit?.inputs.site ?? null);
  const grade = gradeSite(site, { name: row.name, city: row.city, service: phrase?.phrase ?? query });
  const flags = await siteFlags(row, site, true, grade);

  const mismatch = locationMismatch(site, row.city);
  const link = profileLinkProblem(row, site);
  const pay = payingFor(site);
  const findings = [
    mismatch,
    link?.say ?? null,
    leadServiceLine(pay.services),
    pay.builder ? `Site built by ${pay.builder}: they already pay someone for their website.` : null,
  ].filter((x): x is string => !!x);

  let marketKm: number | null = null;
  if (row.lat != null && row.lng != null && row.city) {
    const c = await cityCentre(row.city, row.country_code, state);
    if (c) marketKm = Math.round(km({ lat: row.lat, lng: row.lng }, c) * 10) / 10;
  }

  const at = now();
  let skip = skipReason({ ...lead, address: row.address }, inbound, excluded);
  let priority = skip ? SKIP : callPriority({ case: diagnosis.case, rank, flags, locationMismatch: !!mismatch, paying: pay.paying });
  if (inbound && priority === SKIP) priority = 3; // they asked: never skipped
  let revisitAt: number | null = null;
  if (!skip && priority === SKIP) {
    revisitAt = at + REVISIT;
    skip = `Top 3 with a good website: call back after ${new Date(revisitAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  const seasonal = SEASONAL.has(typeFor(row)?.id ?? "");
  const bigTicket = BIG_TICKET.has(phrase?.phrase ?? "");

  const check: TopCheck = {
    v: 1,
    at,
    query,
    city: row.city,
    rank,
    lead,
    top: top.slice(0, 20),
    diagnosis,
    flags,
    marketKm,
    skip,
    priority,
    seasonal,
    grade,
    findings,
    builder: pay.builder,
    leadServices: pay.services,
    bigTicket,
    revisitAt,
  };
  await db.run(
    `UPDATE businesses SET check_query = ?, check_query_manual = ?, top_check = ?, checked_at = ?, check_case = ?, check_priority = ?, seasonal = ?,
       big_ticket = ?, revisit_at = ?, check_note = NULL, site_builder = CASE WHEN site_builder_manual = 1 THEN site_builder ELSE ? END WHERE id = ?`,
    query,
    manual,
    JSON.stringify(check),
    check.at,
    diagnosis.case,
    priority,
    seasonal ? 1 : 0,
    bigTicket ? 1 : 0,
    revisitAt,
    pay.builder,
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
