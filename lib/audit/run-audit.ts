import pLimit from "p-limit";
import { db, logEvent, now } from "../db";
import { getSettings } from "../settings";
import { BUSINESS_TYPES } from "../discovery/categories";
import { localLang, localTerm } from "../discovery/local-terms";
import {
  GoogleBudgetError,
  cached,
  googleFields,
  googleKey,
  placeDeep,
  placeDetails,
  rankedIds,
  remaining,
  type DeepFacts,
  type GooglePlace,
} from "../discovery/google-api";
import { near, resolveCategory, similarName } from "../discovery/match";
import { checkSite, mobilePageSpeed, type SiteFacts } from "./site";
import { chainReason, formatPhone, nonFitReason } from "../discovery/fit";
import { keywordsFor, scoreAudit, type AuditResult, type BusinessFacts, type GoogleFacts, type ManualAnswers } from "./score";

// Automatic research for each lead: Google profile + map ranking + homepage check → score.
// Runs in the worker. Leads are audited after the email search finishes (or immediately when
// someone presses "Audit"). Re-scoring after manual answers reuses the stored inputs: no network.

export type AuditRow = {
  id: number;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  status: string;
  source: string;
  country_code: string | null;
  google_place_id: string | null;
  google_type: string | null;
  google_types: string | null;
  category_confirmed: number | null;
  rating: number | null;
  review_count: number | null;
  business_status: string | null;
  audit_manual: string | null;
  chain: number;
  deep: string | null;
  social_url?: string | null;
};

const DAY = 86_400_000;
const CONCURRENCY = 4;

const typeFor = (row: AuditRow) => BUSINESS_TYPES.find((t) => t.label === row.category);

/**
 * The search a customer would type: "smoke shop in Austin", or in their own language where that's
 * what people search ("tabaquería en Lima").
 */
export function serviceQuery(row: Pick<AuditRow, "category" | "google_type" | "city" | "country_code"> & { category_confirmed?: number | null }): string | null {
  // An unconfirmed category is only what we searched for ("motorcycle dealer" for a pawn shop):
  // don't rank them for it. Google's own type, if it says something, is the better guess.
  if (row.category_confirmed === 0) {
    const g = row.google_type && !/^(services?|store|point of interest|establishment)$/i.test(row.google_type) ? row.google_type.toLowerCase() : null;
    return g && row.city ? `${g} in ${row.city}` : null;
  }
  const t = BUSINESS_TYPES.find((x) => x.label === row.category);
  const lang = localLang(row.country_code);
  const local = t && lang ? localTerm(t.id, lang) : null;
  if (local && row.city) return `${local} ${LOCAL_IN[lang!]} ${row.city}`;
  const service = (t?.google[0] ?? row.google_type ?? row.category)?.toLowerCase();
  if (!service || !row.city) return null;
  return `${service} in ${row.city}`;
}

const LOCAL_IN: Record<string, string> = { es: "en", pt: "em", fr: "à", de: "in", it: "a", nl: "in" };

type ProfileFields = Pick<GooglePlace, "id" | "displayName" | "googleMapsUri" | "primaryType" | "primaryTypeDisplayName" | "types" | "rating" | "userRatingCount" | "businessStatus">;

/** Store a lead's own Google profile, and re-check its category against Google's types. */
export async function saveProfile(row: AuditRow, p: ProfileFields) {
  const g = googleFields(p as GooglePlace);
  // Leads from a Google search, or with a category nobody confirmed, are re-checked against the profile.
  // A category someone set by hand (2) is never overridden.
  const recheck = row.category_confirmed !== 2 && (row.source === "google" || row.category_confirmed !== 1);
  const cat = recheck ? resolveCategory(row.category, row.name, { primaryType: g.primaryType, primaryTypeLabel: g.type, types: g.types }) : null;
  Object.assign(row, {
    google_place_id: g.placeId,
    google_type: g.type,
    google_types: g.types ? JSON.stringify(g.types) : null,
    rating: g.rating,
    review_count: g.reviewCount,
    business_status: g.status,
    ...(cat?.category ? { category: cat.category, category_confirmed: cat.confirmed ? 1 : 0 } : {}),
  });
  await db.run(
    `UPDATE businesses SET google_place_id = ?, google_maps_url = ?, google_type = ?, google_types = ?, rating = ?, review_count = ?,
       business_status = ?, category = ?, category_confirmed = ? WHERE id = ?`,
    g.placeId,
    g.mapsUrl,
    g.type,
    row.google_types,
    g.rating,
    g.reviewCount,
    g.status,
    row.category,
    row.category_confirmed,
    row.id,
  );
}

/** Forget a Google profile that turned out to belong to another business; the next audit matches again. */
export async function detachProfile(row: AuditRow) {
  Object.assign(row, { google_place_id: null, google_type: null, google_types: null, rating: null, review_count: null, business_status: null, deep: null });
  await db.run(
    `UPDATE businesses SET google_place_id = NULL, google_maps_url = NULL, google_type = NULL, google_types = NULL, rating = NULL,
       review_count = NULL, business_status = NULL, deep = NULL, deep_at = NULL WHERE id = ?`,
    row.id,
  );
}

/** Is this Google profile really this lead? Same name, or the same spot with a similar name. */
export const profileMatches = (row: Pick<AuditRow, "name" | "lat" | "lng">, p: Pick<GooglePlace, "displayName" | "location">) =>
  similarName(p.displayName?.text ?? "", row.name) &&
  (row.lat == null || p.location == null || near(row, { lat: p.location.latitude, lng: p.location.longitude }, 0.01));

async function researchGoogle(row: AuditRow): Promise<GoogleFacts> {
  const blank: GoogleFacts = {
    checked: false,
    found: false,
    type: row.google_type,
    rating: row.rating,
    reviewCount: row.review_count,
    status: row.business_status,
    rank: null,
    rankQuery: null,
    brandedTop: null,
    note: null,
  };
  if (!(await googleKey())) return blank;
  if (row.lat == null || row.lng == null) return { ...blank, note: "No map location for this business" };

  try {
    let placeId = row.google_place_id;
    // Match an OpenStreetMap lead to its Google profile: free ID search, then one Details call.
    if (!placeId) {
      if ((await remaining("details_ent")) <= 0) return { ...blank, note: "Google free allowance for profile lookups is used up this month" };
      const q = [row.name, row.address ?? row.city].filter(Boolean).join(", ");
      const ids = await rankedIds(q, row.lat, row.lng, 300);
      for (const id of ids.slice(0, 2)) {
        const p = await placeDetails(id);
        const close = near({ lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null }, row);
        if (close && similarName(p.displayName?.text ?? "", row.name)) {
          placeId = p.id;
          await saveProfile(row, p);
          await db.run("UPDATE businesses SET phone = COALESCE(phone, ?) WHERE id = ?", formatPhone(p.nationalPhoneNumber, row.country_code), row.id);
          break;
        }
      }
      if (!placeId) return { ...blank, checked: true, found: false };
    }

    const facts: GoogleFacts = {
      checked: true,
      found: true,
      type: row.google_type,
      rating: row.rating,
      reviewCount: row.review_count ?? 0,
      status: row.business_status,
      rank: null,
      rankQuery: null,
      brandedTop: null,
    };

    // Map pack: rank in "service in city", searched from the business's neighbourhood. Cached per area for a week.
    const rq = serviceQuery(row);
    if (rq) {
      const key = `rank:${rq.toLowerCase()}:${row.lat.toFixed(2)},${row.lng.toFixed(2)}`;
      const ids = await cached(key, 7 * DAY, () => rankedIds(rq, row.lat!, row.lng!, 5000, localLang(row.country_code)));
      const pos = ids.indexOf(placeId);
      facts.rankQuery = rq;
      facts.rank = pos >= 0 ? pos + 1 : null;
    }
    // Branded search: do they come first for their own name?
    const bq = [row.name, row.city].filter(Boolean).join(" ");
    const branded = await cached(`brand:${bq.toLowerCase()}`, 30 * DAY, () => rankedIds(bq, row.lat!, row.lng!, 10000));
    facts.brandedTop = branded[0] === placeId;
    return facts;
  } catch (e) {
    if (e instanceof GoogleBudgetError) return { ...blank, note: e.message };
    throw e;
  }
}

function inputsFrom(row: AuditRow, site: SiteFacts | null, google: GoogleFacts) {
  const t = typeFor(row);
  const business: BusinessFacts = {
    name: row.name,
    category: row.category,
    categoryConfirmed: row.category_confirmed !== 0,
    city: row.city,
    phone: row.phone,
    website: row.website,
    email: row.email,
    status: row.status,
    source: row.source,
    countryCode: row.country_code,
    chain: !!row.chain,
    // Chains and non-fits are re-derived on every score, so a longer brand list fixes old leads too.
    chainReason: chainReason(row),
    nonFit: nonFitReason({ name: row.name, googleLabel: row.google_type, categoryId: t?.id }),
    socialUrl: row.social_url ?? null,
  };
  return {
    business,
    site,
    google,
    keywords: keywordsFor(
      [row.category, row.google_type, ...(t?.google ?? []), t && localLang(row.country_code) ? localTerm(t.id, localLang(row.country_code)!) : null],
      t?.names ?? [],
    ),
    year: new Date().getFullYear(),
  };
}

async function save(id: number, r: AuditResult) {
  await db.run(
    `UPDATE businesses SET audit = ?, audit_status = 'done', audited_at = ?, visibility_score = ?, conversion_score = ?, priority = ?, tier = ?
     WHERE id = ?`,
    JSON.stringify(r),
    now(),
    r.visibility.score,
    r.conversion.score,
    r.priority,
    r.tier,
    id,
  );
}

const DEEP_MAX_AGE = 30 * DAY;

/**
 * The deep pass for leads worth calling: Google profile details (reviews, photos, hours) and a mobile
 * PageSpeed score. Stays inside the free monthly allowance; `force` re-fetches (the Deep audit button).
 */
async function deepen(row: AuditRow, site: SiteFacts | null, google: GoogleFacts, key: string | undefined, force = false) {
  let deep: DeepFacts | null = row.deep ? (JSON.parse(row.deep) as DeepFacts) : null;
  const stale = !deep || force || now() - deep.at > DEEP_MAX_AGE;
  // "changed": the stored profile was another business (detached) or the category moved: research again.
  let changed = false;
  if (google.found && row.google_place_id && stale && key && (await remaining("details_atmos")) > 0) {
    try {
      const r = await placeDeep(row.google_place_id);
      if (!profileMatches(row, r.place)) {
        await logEvent("warn", `Lead #${row.id} ${row.name}: its Google profile was "${r.place.displayName?.text}", another business. Matching again.`);
        await detachProfile(row);
        return { site, google, changed: true };
      }
      const category = row.category;
      await saveProfile(row, r.place);
      changed = row.category !== category;
      deep = r.facts;
      Object.assign(google, { type: row.google_type, rating: row.rating, reviewCount: row.review_count ?? 0, status: row.business_status });
      await db.run("UPDATE businesses SET deep = ?, deep_at = ? WHERE id = ?", JSON.stringify(deep), deep.at, row.id);
    } catch (e) {
      if (!(e instanceof GoogleBudgetError)) await logEvent("warn", `Deep audit of #${row.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  let nextSite = site;
  if (site?.reachable && site.url && site.pageSpeed == null && key) {
    const score = await mobilePageSpeed(site.url, key);
    if (score != null) nextSite = { ...site, pageSpeed: score };
  }
  return { site: nextSite, google: { ...google, deep }, changed };
}

export async function auditOne(id: number, opts: { forceDeep?: boolean; retried?: boolean } = {}): Promise<AuditResult | null> {
  const row = await db.get<AuditRow>("SELECT * FROM businesses WHERE id = ?", id);
  if (!row) return null;
  await db.run("UPDATE businesses SET audit_status = 'running', audited_at = ? WHERE id = ?", now(), id);
  const s = await getSettings();
  const key = await googleKey();
  try {
    const [site, g] = await Promise.all([
      row.website ? checkSite(row.website, { pageSpeed: s.auditPageSpeed, googleKey: key }) : Promise.resolve(null),
      researchGoogle(row),
    ]);
    const google: GoogleFacts = { ...g, deep: row.deep ? (JSON.parse(row.deep) as DeepFacts) : null };
    const manual = row.audit_manual ? (JSON.parse(row.audit_manual) as ManualAnswers) : {};
    let result = scoreAudit(inputsFrom(row, site, google), manual);
    // Top leads (and anyone who pressed Deep audit) get the deeper Google + speed checks, then a rescore.
    if (opts.forceDeep || result.tier === "A" || result.tier === "B") {
      const more = await deepen(row, site, google, key, opts.forceDeep);
      // Wrong profile or new category: the ranking search and talking points must be redone (once).
      if (more.changed && !opts.retried) return auditOne(id, { ...opts, retried: true });
      result = scoreAudit(inputsFrom(row, more.site, more.google), manual);
    }
    await save(id, result);
    return result;
  } catch (e) {
    await db.run("UPDATE businesses SET audit_status = 'failed', audited_at = ? WHERE id = ?", now(), id);
    await logEvent("warn", `Audit of business #${id} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Re-score from stored inputs (after a manual answer, or new scoring rules). Instant, no network.
 * `site` swaps in a fresh website check (scripts/recheck.ts).
 */
export async function rescore(id: number, opts: { site?: SiteFacts | null } = {}): Promise<AuditResult | null> {
  const row = await db.get<AuditRow & { audit: string | null }>("SELECT * FROM businesses WHERE id = ?", id);
  if (!row?.audit) return null;
  const prev = JSON.parse(row.audit) as AuditResult;
  const manual = row.audit_manual ? (JSON.parse(row.audit_manual) as ManualAnswers) : {};
  // Refresh business facts (phone/email/status may have changed since the audit), and the deep data.
  // Profile facts stored on the lead are fresher than the audit's copy (verify-profiles refreshes them).
  const pg = prev.inputs.google;
  const google = {
    ...pg,
    ...(pg.found && row.google_place_id
      ? { type: row.google_type ?? pg.type, rating: row.rating ?? pg.rating, reviewCount: row.review_count ?? pg.reviewCount, status: row.business_status ?? pg.status }
      : {}),
    deep: row.deep ? (JSON.parse(row.deep) as DeepFacts) : (pg.deep ?? null),
  };
  const inputs = { ...prev.inputs, google, business: inputsFrom(row, null, google).business, ...(opts.site !== undefined ? { site: opts.site } : {}) };
  const result = scoreAudit(inputs, manual);
  await save(id, result);
  return result;
}

/** Worker batch: requested audits first, then (if enabled) every lead whose email search has finished. */
export async function auditBatch(batchSize = 12): Promise<number> {
  const auto = (await getSettings()).autoAudit;
  // Audits stuck in "running" for 10+ minutes (a background tick that died) are picked up again.
  const ids = await db.all<{ id: number }>(
    `SELECT id FROM businesses
     WHERE audit_status = 'queued'
        OR (audit_status = 'running' AND audited_at < ?)
        OR (? = 1 AND audit_status IS NULL AND status NOT IN ('pending', 'excluded'))
     ORDER BY (audit_status = 'queued') DESC, id LIMIT ?`,
    now() - 10 * 60_000,
    auto ? 1 : 0,
    batchSize,
  );
  if (ids.length === 0) return 0;
  const limit = pLimit(CONCURRENCY);
  await Promise.all(ids.map(({ id }) => limit(() => auditOne(id))));
  return ids.length;
}
