import { db, now } from "../db";
import { getSecret, getSettings, getSys } from "../settings";
import { fetchWithTimeout } from "./http";

// Thin client for Google Places API (New) with a monthly usage guard.
//
// Google bills per request by "SKU", and each SKU has its own free monthly allowance
// (per billing account, shared with anything else you use the key for):
//   text_ids     Text Search, IDs only             unlimited free   (used for map-pack ranking)
//   text_ent     Text Search with phone/website/…  1,000 free/month (used for lead searches, 20 results each)
//   details_ent  Place Details with rating/…        1,000 free/month (used to match OSM leads to Google)
// With "stay in the free tier" on (default), calls stop when our own count reaches the allowance.

export type Sku = "text_ids" | "text_ent" | "details_ent" | "details_atmos";

export const FREE_PER_MONTH: Record<Sku, number> = { text_ids: Infinity, text_ent: 1000, details_ent: 1000, details_atmos: 1000 };
export const SKU_LABEL: Record<Sku, string> = {
  text_ids: "Map ranking checks (free)",
  text_ent: "Lead searches (20 businesses each)",
  details_ent: "Profile lookups for audits",
  details_atmos: "Deep audits (reviews, photos, hours) for top leads",
};

export class GoogleBudgetError extends Error {}

const month = () => new Date().toISOString().slice(0, 7);
const usageKey = (sku: Sku) => `google:${month()}:${sku}`;

export async function googleUsage(): Promise<Record<Sku, number>> {
  const [ids, ent, det, atm] = await Promise.all([
    getSys(usageKey("text_ids")),
    getSys(usageKey("text_ent")),
    getSys(usageKey("details_ent")),
    getSys(usageKey("details_atmos")),
  ]);
  return { text_ids: Number(ids ?? 0), text_ent: Number(ent ?? 0), details_ent: Number(det ?? 0), details_atmos: Number(atm ?? 0) };
}

export async function remaining(sku: Sku): Promise<number> {
  if (!(await getSettings()).googleFreeTierOnly) return Infinity;
  return FREE_PER_MONTH[sku] - (await googleUsage())[sku];
}

async function count(sku: Sku) {
  // Atomic increment, so parallel requests don't lose counts.
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
    `sys:${usageKey(sku)}`,
  );
}

export function googleKey(): Promise<string | undefined> {
  return getSecret("googlePlacesApiKey");
}

async function call<T>(sku: Sku, url: string, init: RequestInit & { fieldMask: string }): Promise<T> {
  const key = await googleKey();
  if (!key) throw new Error("Google Places API key is not set (Settings → Data sources).");
  if ((await remaining(sku)) <= 0)
    throw new GoogleBudgetError(`Google free monthly allowance used up (${SKU_LABEL[sku]}). Raise it in Settings or wait until next month.`);
  await count(sku);
  const res = await fetchWithTimeout(url, {
    ...init,
    timeoutMs: 20000,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": init.fieldMask },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 300);
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {}
    throw new Error(`Google Places ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}

export type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  addressComponents?: { shortText?: string; types?: string[] }[];
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
};

// Fields used for leads. Phone, website and rating put requests on the "Enterprise" SKU.
const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "location",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "addressComponents",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "businessStatus",
];

type Rect = { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };

/** Full text search (Enterprise SKU): one page of up to 20 places. */
export async function textSearchPage(textQuery: string, rect: Rect, pageToken?: string, languageCode?: string | null) {
  return call<{ places?: GooglePlace[]; nextPageToken?: string }>("text_ent", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    fieldMask: [...PLACE_FIELDS.map((f) => `places.${f}`), "nextPageToken"].join(","),
    body: JSON.stringify({ textQuery, pageSize: 20, pageToken, locationRestriction: { rectangle: rect }, ...(languageCode ? { languageCode } : {}) }),
  });
}

/** IDs-only text search (free, unlimited): ordered place IDs, like the results list in Google Maps. */
export async function rankedIds(textQuery: string, lat: number, lng: number, radiusM = 5000, languageCode?: string | null): Promise<string[]> {
  const j = await call<{ places?: { id: string }[] }>("text_ids", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    fieldMask: "places.id",
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      ...(languageCode ? { languageCode } : {}),
    }),
  });
  return (j.places ?? []).map((p) => p.id);
}

/** One result of the top-3 check's search: enough to compare a lead with who outranks it. */
export type RankedPlace = { id: string; name: string; rating: number | null; reviews: number | null; category: string | null; primaryType: string | null; status: string | null };

/**
 * The top-3 check's search (Competitor Check spec v2): up to 20 places in Google's order for a
 * search, biased to a circle around the lead (~15 km). Ratings and review counts put it on the
 * "Enterprise" text SKU; callers cache it per search and area (many leads share one).
 */
export async function topResults(textQuery: string, lat: number, lng: number, radiusM = 15000, languageCode?: string | null): Promise<RankedPlace[]> {
  const fields = ["id", "displayName", "rating", "userRatingCount", "primaryType", "primaryTypeDisplayName", "businessStatus"];
  const j = await call<{ places?: GooglePlace[] }>("text_ent", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    fieldMask: fields.map((f) => `places.${f}`).join(","),
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      ...(languageCode ? { languageCode } : {}),
    }),
  });
  return (j.places ?? []).map((p) => ({
    id: p.id,
    name: p.displayName?.text ?? "",
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    category: p.primaryTypeDisplayName?.text ?? null,
    primaryType: p.primaryType ?? null,
    status: p.businessStatus ?? null,
  }));
}

/** Find a business's own Google profile from its name and city (site and Meta leads). Enterprise SKU. */
export async function findPlace(textQuery: string, lat?: number | null, lng?: number | null): Promise<GooglePlace | null> {
  const j = await call<{ places?: GooglePlace[] }>("text_ent", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    fieldMask: PLACE_FIELDS.map((f) => `places.${f}`).join(","),
    body: JSON.stringify({
      textQuery,
      pageSize: 1,
      ...(lat != null && lng != null ? { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 30000 } } } : {}),
    }),
  });
  return j.places?.[0] ?? null;
}

/** Drop a cached lookup, so the next cached() call fetches fresh (the Re-run button). */
export async function uncache(key: string) {
  await db.run("DELETE FROM google_cache WHERE key = ?", key);
}

/** Place Details (Enterprise SKU). */
export async function placeDetails(placeId: string): Promise<GooglePlace> {
  return call<GooglePlace>("details_ent", `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask: PLACE_FIELDS.join(","),
  });
}

/** What the deep audit learns from a Google profile. */
export type DeepFacts = {
  at: number;
  reviewsSampled: number; // Google returns up to 5 "most relevant" reviews
  newestReviewDays: number | null; // age of the newest of those
  photos: number; // up to 10 returned; 10 means "10 or more"
  ownerPhotos: number; // photos credited to the business itself
  hours: boolean; // opening hours filled in
  description: boolean; // Google's editorial summary / business description
};

type DeepPlace = {
  displayName?: { text: string };
  reviews?: { publishTime?: string }[];
  photos?: { authorAttributions?: { displayName?: string }[] }[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  editorialSummary?: { text?: string };
};

// The deep call is already the top-priced SKU, so it also re-reads the profile basics for free:
// the audit uses them to check the stored profile is really this business and refresh it.
const DEEP_FIELDS = [
  "id",
  "displayName",
  "location",
  "googleMapsUri",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "rating",
  "userRatingCount",
  "businessStatus",
  "reviews",
  "photos",
  "regularOpeningHours",
  "editorialSummary",
];

/** Place Details with reviews, photos and hours ("Enterprise + Atmosphere" SKU): the deep audit. */
export async function placeDeep(placeId: string, now = Date.now()): Promise<{ facts: DeepFacts; place: GooglePlace }> {
  const p = await call<DeepPlace & GooglePlace>("details_atmos", `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask: DEEP_FIELDS.join(","),
  });
  return { facts: deepFacts(p, now), place: p };
}

export function deepFacts(p: DeepPlace, now = Date.now()): DeepFacts {
  const times = (p.reviews ?? []).map((r) => Date.parse(r.publishTime ?? "")).filter((t) => Number.isFinite(t));
  const name = (p.displayName?.text ?? "").toLowerCase().trim();
  return {
    at: now,
    reviewsSampled: p.reviews?.length ?? 0,
    newestReviewDays: times.length ? Math.floor((now - Math.max(...times)) / 86_400_000) : null,
    photos: p.photos?.length ?? 0,
    ownerPhotos: (p.photos ?? []).filter((ph) => ph.authorAttributions?.some((a) => !!name && (a.displayName ?? "").toLowerCase().trim() === name)).length,
    hours: !!p.regularOpeningHours?.weekdayDescriptions?.length,
    description: !!p.editorialSummary?.text,
  };
}

/** Cache for ranking lookups: many leads in one city share the same "service in city" search. */
export async function cached<T>(key: string, maxAgeMs: number, fn: () => Promise<T>): Promise<T> {
  const row = await db.get<{ value: string; created_at: number }>("SELECT value, created_at FROM google_cache WHERE key = ?", key);
  if (row && now() - row.created_at < maxAgeMs) return JSON.parse(row.value) as T;
  const value = await fn();
  await db.run(
    "INSERT INTO google_cache (key, value, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
    key,
    JSON.stringify(value),
    now(),
  );
  return value;
}

export const googleFields = (p: GooglePlace) => ({
  placeId: p.id,
  mapsUrl: p.googleMapsUri ?? null,
  type: p.primaryTypeDisplayName?.text ?? null,
  primaryType: p.primaryType ?? null,
  types: p.types ?? null,
  rating: p.rating ?? null,
  reviewCount: p.userRatingCount ?? (p.id ? 0 : null),
  status: p.businessStatus ?? null,
});
