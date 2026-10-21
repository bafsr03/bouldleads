import { labelForTags, osmFiltersFor } from "./categories";
import { fetchWithTimeout, sleep } from "./http";

export type SearchArea =
  | { type: "circle"; lat: number; lng: number; radiusKm: number; label?: string }
  | { type: "place"; label: string; bbox: [number, number, number, number]; areaId: number | null };

export type BBox = [number, number, number, number]; // south, west, north, east

export type DiscoveredBusiness = {
  sourceId: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  /** A Facebook / Instagram / Yelp page given as the website: kept, but it isn't a site of their own. */
  socialUrl?: string | null;
  email: string | null;
  google?: {
    placeId: string;
    mapsUrl: string | null;
    type: string | null;
    primaryType?: string | null;
    types?: string[] | null;
    rating: number | null;
    reviewCount: number | null;
    status: string | null;
  };
  /** false = the category is only the search term, Google didn't confirm it (see lib/discovery/match.ts). */
  categoryConfirmed?: boolean;
};

/** Which contact detail a search requires: 1 = website or email, 2 = any (phone counts), 0 = none. */
export type ContactMode = 0 | 1 | 2;

const ENDPOINTS = (
  process.env.OVERPASS_ENDPOINTS ??
  "https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const TILE_DEG = 0.25; // ~28km tiles keep each query well under Overpass limits

export function areaBbox(area: SearchArea): BBox {
  if (area.type === "place") return area.bbox;
  const dLat = area.radiusKm / 111.32;
  const dLng = area.radiusKm / (111.32 * Math.max(0.1, Math.cos((area.lat * Math.PI) / 180)));
  return [area.lat - dLat, area.lng - dLng, area.lat + dLat, area.lng + dLng];
}

export function splitBbox([s, w, n, e]: BBox, size = TILE_DEG): BBox[] {
  const tiles: BBox[] = [];
  const rows = Math.max(1, Math.ceil((n - s) / size));
  const cols = Math.max(1, Math.ceil((e - w) / size));
  const h = (n - s) / rows;
  const wd = (e - w) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push([s + r * h, w + c * wd, s + (r + 1) * h, w + (c + 1) * wd].map((v) => +v.toFixed(6)) as BBox);
    }
  }
  return tiles;
}

export function quarter([s, w, n, e]: BBox): BBox[] {
  const mLat = (s + n) / 2;
  const mLng = (w + e) / 2;
  return [
    [s, w, mLat, mLng],
    [s, mLng, mLat, e],
    [mLat, w, n, mLng],
    [mLat, mLng, n, e],
  ];
}

export function buildQuery(area: SearchArea, tile: BBox, selection: string[], contactMode: ContactMode): string {
  const filters = osmFiltersFor(selection);
  const contact =
    contactMode === 1
      ? '[~"^(website|contact:website|url|email|contact:email)$"~"."]'
      : contactMode === 2
        ? '[~"^(website|contact:website|url|email|contact:email|phone|contact:phone|contact:mobile|mobile|contact:facebook|contact:instagram)$"~"."]'
        : "";
  const scope = area.type === "circle" ? `(around:${Math.round(area.radiusKm * 1000)},${area.lat},${area.lng})` : area.areaId ? `(area:${area.areaId})` : "";
  const bbox = `(${tile.join(",")})`;
  const lines = filters.map((f) => `  nwr${f}["name"]${contact}${scope}${bbox};`);
  return `[out:json][timeout:180];\n(\n${lines.join("\n")}\n);\nout tags center;`;
}

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};


// Social and directory pages people list as their "website".
const SOCIAL_HOST = /(^|\.)(facebook|instagram|twitter|x|tiktok|linkedin|youtube)\.com$|(^|\.)fb\.com$/i;
const LISTING_HOST =
  /(^|\.)(yelp\.com|yellowpages\.com|manta\.com|bbb\.org|mapquest\.com|nextdoor\.com|angi\.com|homeadvisor\.com|thumbtack\.com|houzz\.com|porch\.com|usmap[a-z0-9-]*\.(org|com|net))$/i;

function parseUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null;
  let v = raw.split(/[;\s]/)[0].trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return u.hostname.includes(".") ? u : null;
  } catch {
    return null;
  }
}

const isSocialOrListing = (u: URL) => {
  const h = u.hostname.replace(/^www\./, "");
  // Anchored on a dot or the start: "clearchoiceroofingatx.com" is a real website, not x.com.
  return SOCIAL_HOST.test(h) || LISTING_HOST.test(h);
};

/** Their own website, or null. Social profiles and directory listings aren't a site of their own. */
export function normalizeWebsite(raw: string | undefined | null): string | null {
  const u = parseUrl(raw);
  return u && !isSocialOrListing(u) ? u.toString() : null;
}

/** The Facebook / Instagram / Yelp page given as their website, if that's what it is. */
export function socialUrl(raw: string | undefined | null): string | null {
  const u = parseUrl(raw);
  return u && isSocialOrListing(u) ? u.toString() : null;
}

// Public bodies and institutions: never a Bould prospect (they show up under "All businesses").
const NOT_A_BUSINESS: Record<string, RegExp> = {
  office: /^(government|diplomatic|ngo|association|political_party|religion|union|foundation)$/,
  amenity:
    /^(embassy|townhall|courthouse|police|fire_station|prison|school|kindergarten|college|university|library|place_of_worship|social_facility|community_centre|post_office|public_building|grave_yard|monastery)$/,
  government: /./,
  diplomatic: /./,
  military: /./,
};

export const isNotABusiness = (t: Record<string, string>) => Object.entries(NOT_A_BUSINESS).some(([k, re]) => t[k] != null && re.test(t[k]));

export function parseElement(el: OsmElement): DiscoveredBusiness | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  if (isNotABusiness(t)) return null;
  // Skip chains/franchises (OSM links brands to Wikidata); they aren't local-business leads.
  if (t["brand:wikidata"] || t["operator:wikidata"]) return null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const address = [street, t["addr:postcode"], t["addr:city"]].filter(Boolean).join(", ") || null;
  const email = (t.email ?? t["contact:email"] ?? "").split(/[;,\s]/)[0].trim().toLowerCase() || null;
  return {
    sourceId: `${el.type}/${el.id}`,
    name: t.name,
    category: labelForTags(t),
    address,
    city: t["addr:city"] ?? null,
    countryCode: t["addr:country"]?.toUpperCase() ?? null,
    lat: el.lat ?? el.center?.lat ?? null,
    lng: el.lon ?? el.center?.lon ?? null,
    phone: t.phone ?? t["contact:phone"] ?? null,
    website: normalizeWebsite(t.website ?? t["contact:website"] ?? t.url),
    socialUrl: socialUrl(t.website ?? t["contact:website"] ?? t.url) ?? socialUrl(t["contact:facebook"]) ?? socialUrl(t["contact:instagram"]),
    email,
  };
}

class OverpassTooBig extends Error {}

let endpointIdx = 0;

async function runQuery(query: string): Promise<OsmElement[]> {
  let lastErr: unknown;
  const attempts = Math.max(8, ENDPOINTS.length * 3);
  const backoff = (attempt: number) => Math.min(60_000, 4000 * 2 ** Math.min(attempt, 4));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const endpoint = ENDPOINTS[endpointIdx % ENDPOINTS.length];
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        timeoutMs: 120_000, // a hung mirror is abandoned and the next one tried
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (res.status === 429 || res.status === 504 || res.status >= 500) {
        endpointIdx++;
        await sleep(backoff(attempt));
        lastErr = new Error(`Overpass ${res.status} from ${endpoint}`);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`Overpass ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text) as { elements: OsmElement[]; remark?: string };
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new OverpassTooBig(json.remark);
      return json.elements;
    } catch (e) {
      if (e instanceof OverpassTooBig) throw e;
      lastErr = e;
      endpointIdx++;
      await sleep(backoff(attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Query one tile; if Overpass says it's too big, split into quarters (up to 3 levels). */
export async function queryTile(
  area: SearchArea,
  tile: BBox,
  selection: string[],
  contactMode: ContactMode,
  depth = 0,
): Promise<DiscoveredBusiness[]> {
  try {
    const elements = await runQuery(buildQuery(area, tile, selection, contactMode));
    return elements.map(parseElement).filter((b): b is DiscoveredBusiness => b !== null);
  } catch (e) {
    if (e instanceof OverpassTooBig && depth < 3) {
      const out: DiscoveredBusiness[] = [];
      for (const q of quarter(tile)) out.push(...(await queryTile(area, q, selection, contactMode, depth + 1)));
      return out;
    }
    throw e;
  }
}
