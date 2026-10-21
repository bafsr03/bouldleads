import { db, logEvent, marks, now, type Stmt } from "../db";
import { googleKey } from "./google-api";
import { googleSearch } from "./google-places";
import { areaBbox, queryTile, splitBbox, type ContactMode, type DiscoveredBusiness, type SearchArea } from "./overpass";
import { sleep } from "./http";
import { similarName } from "./match";
import { formatPhone } from "./fit";

type SearchRow = {
  id: number;
  source: "osm" | "google" | "both";
  area: string;
  categories: string;
  country_code: string | null;
  require_website: number;
  max_results: number;
  status: string;
  found: number;
  cursor: string | null;
};

/** Where a search left off, so it can continue on the next background tick. */
type Cursor = { googleDone?: boolean; googleTerm?: number; nextTile?: number; failedTiles?: number; lastTileError?: string; notes?: string[] };

// Hosts many unrelated businesses share (link pages, chat links, short links, Google Sites/Maps):
// a matching "domain" there says nothing about two listings being the same business or a chain.
const SHARED_HOSTS = /^(sites\.google\.com|google\.com|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl|g\.page|linktr\.ee|beacons\.ai|linkin\.bio|taplink\.cc|msha\.ke|wa\.me|api\.whatsapp\.com|wa\.link|bit\.ly|tinyurl\.com|fb\.com|m\.me|t\.me|instagram\.com|facebook\.com|tiktok\.com|yelp\.com|business\.site|booksy\.com|fresha\.com|square\.site)$/i;

/** Same name at 3+ locations anywhere in the database: a chain, even when each search found only one. */
export const CHAIN_BY_NAME_SQL = `UPDATE businesses SET chain = 1 WHERE chain = 0 AND lower(name) IN (
  SELECT lower(name) FROM businesses GROUP BY lower(name) HAVING COUNT(*) >= 3)`;

export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return SHARED_HOSTS.test(host) ? null : host;
  } catch {
    return null;
  }
}

export const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Keys that identify a business in the "dismissed" list (leads someone deleted). */
export function dismissKeys(b: { source?: string | null; sourceId?: string | null; placeId?: string | null; domain?: string | null }): string[] {
  const keys: string[] = [];
  if (b.placeId) keys.push(`place:${b.placeId}`);
  if (b.source && b.sourceId) keys.push(`src:${b.source}:${b.sourceId}`);
  if (b.domain) keys.push(`domain:${b.domain}`);
  return keys;
}

type Known = {
  id: number;
  name: string;
  domain: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  email: string | null;
  phone: string | null;
};

/** Last 8 digits of a phone: the same line written with or without country code, spaces, dashes. */
export const phoneKey = (p: string | null | undefined): string | null => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-8) : null;
};

const chunks = <T>(a: T[], n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Existing rows that could match this batch: everything in its bounding box plus same domain / email / place. */
async function loadKnown(list: DiscoveredBusiness[], domains: string[]): Promise<Known[]> {
  const cols = "id, name, domain, lat, lng, google_place_id, email, phone";
  const out = new Map<number, Known>();
  const pts = list.filter((b) => b.lat != null && b.lng != null);
  if (pts.length) {
    const d = 0.003;
    const lats = pts.map((b) => b.lat!);
    const lngs = pts.map((b) => b.lng!);
    const rows = await db.all<Known>(
      `SELECT ${cols} FROM businesses WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
      Math.min(...lats) - d,
      Math.max(...lats) + d,
      Math.min(...lngs) - d,
      Math.max(...lngs) + d,
    );
    for (const r of rows) out.set(r.id, r);
  }
  const lookups: [string, string[]][] = [
    ["domain", domains],
    ["email", list.map((b) => b.email).filter((e): e is string => !!e)],
    ["google_place_id", list.map((b) => b.google?.placeId).filter((e): e is string => !!e)],
  ];
  for (const [col, values] of lookups)
    for (const part of chunks([...new Set(values)]))
      for (const r of await db.all<Known>(`SELECT ${cols} FROM businesses WHERE ${col} IN (${marks(part.length)})`, ...part)) out.set(r.id, r);
  return [...out.values()];
}

/**
 * Insert businesses, skipping duplicates. The same business found by both OpenStreetMap and
 * Google (same name within ~200 m, or same Google place) is merged into one row so it keeps
 * the OSM email and gains the Google rating, reviews and profile link.
 * Other businesses sharing a website domain (chains, franchise locations) are skipped, and so are
 * leads someone deleted before. Returns # inserted.
 */
export async function insertBusinesses(searchId: number, list: DiscoveredBusiness[], source: string, fallbackCountry: string | null): Promise<number> {
  if (list.length === 0) return 0;
  const domains = list.map((b) => domainOf(b.website)).filter((d): d is string => !!d);
  const known = await loadKnown(list, domains);
  const allKeys = list.flatMap((b) =>
    dismissKeys({ source, sourceId: b.sourceId, placeId: b.google?.placeId, domain: domainOf(b.website) }),
  );
  const dismissed = new Set<string>();
  for (const part of chunks([...new Set(allKeys)]))
    for (const r of await db.all<{ key: string }>(`SELECT key FROM dismissed WHERE key IN (${marks(part.length)})`, ...part)) dismissed.add(r.key);

  const findSame = (b: DiscoveredBusiness, domain: string | null): (Known & { skip?: boolean }) | undefined => {
    if (b.google) {
      const r = known.find((k) => k.google_place_id === b.google!.placeId);
      if (r) return r;
    }
    if (b.lat != null && b.lng != null) {
      const d = 0.002; // ~200 m
      const name = normName(b.name);
      const hit = known.find((r) => {
        if (r.lat == null || r.lng == null || Math.abs(r.lat - b.lat!) > d || Math.abs(r.lng - b.lng!) > d) return false;
        const n = normName(r.name);
        return n === name || (n.length > 4 && name.length > 4 && (n.includes(name) || name.includes(n))) || (!!domain && r.domain === domain);
      });
      if (hit) return hit;
    }
    if (domain) {
      const r = known.find((k) => k.domain === domain);
      if (r && normName(r.name) === normName(b.name)) return r;
    }
    // Same phone number and a similar name = two Google listings of one shop: one lead, one call.
    // A different name on the same number (an owner with two companies, "The Max Detail" and
    // "Curby Bro's") is another business: skip it so the number is called once, but never mix its
    // Google profile into the existing lead.
    const pk = phoneKey(b.phone);
    if (pk) {
      const r = known.find((k) => phoneKey(k.phone) === pk);
      if (r) return similarName(r.name, b.name) ? r : { ...r, skip: true };
    }
    return undefined;
  };

  // Chains: several locations sharing a website, or the same name ("mydentist, Stevenson Square",
  // "mydentist, Didsbury"…) 3+ times in this batch. They aren't local-business leads.
  const nameRoot = (n: string) => normName(n.split(/,| - | – | \| /)[0]);
  const rootCount = new Map<string, number>();
  const domainCount = new Map<string, number>();
  for (const b of list) {
    const r = nameRoot(b.name);
    if (r.length >= 4) rootCount.set(r, (rootCount.get(r) ?? 0) + 1);
    const d = domainOf(b.website);
    if (d) domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
  }
  const chainRoots = [...rootCount].filter(([, n]) => n >= 3).map(([r]) => r);
  const chainDomains = [...domainCount].filter(([, n]) => n >= 2).map(([d]) => d);

  const stmts: Stmt[] = [];
  const skippedSharedPhone: string[] = [];
  for (const raw of list) {
    // One phone format ("(435) 884-3390"), so the same number always looks the same.
    const b = { ...raw, phone: formatPhone(raw.phone, raw.countryCode ?? fallbackCountry) };
    const domain = domainOf(b.website);
    const g = b.google;
    const gParams = {
      placeId: g?.placeId ?? null,
      mapsUrl: g?.mapsUrl ?? null,
      gType: g?.type ?? null,
      rating: g?.rating ?? null,
      reviewCount: g?.reviewCount ?? null,
      bStatus: g?.status ?? null,
      gTypes: g?.types?.length ? JSON.stringify(g.types) : null,
    };
    if (dismissKeys({ source, sourceId: b.sourceId, placeId: g?.placeId, domain }).some((k) => dismissed.has(k))) continue;
    const same = findSame(b, domain);
    if (same?.skip) {
      skippedSharedPhone.push(`${b.name} (same phone as ${same.id > 0 ? `lead #${same.id} ` : ""}${same.name})`);
      continue;
    }
    if (same) {
      // Fill gaps on the existing row without overwriting what's already known. Google fields only
      // come from the row's own Google listing: never mix two profiles into one lead.
      const own = "(google_place_id IS NULL OR google_place_id = @placeId)";
      if (same.id > 0)
        stmts.push([
          `UPDATE businesses SET
            google_place_id = COALESCE(google_place_id, @placeId),
            google_maps_url = CASE WHEN ${own} THEN COALESCE(@mapsUrl, google_maps_url) ELSE google_maps_url END,
            google_type = CASE WHEN ${own} THEN COALESCE(@gType, google_type) ELSE google_type END,
            google_types = CASE WHEN ${own} THEN COALESCE(@gTypes, google_types) ELSE google_types END,
            rating = CASE WHEN ${own} THEN COALESCE(@rating, rating) ELSE rating END,
            review_count = CASE WHEN ${own} THEN COALESCE(@reviewCount, review_count) ELSE review_count END,
            business_status = CASE WHEN ${own} THEN COALESCE(@bStatus, business_status) ELSE business_status END,
            phone = COALESCE(phone, @phone),
            website = COALESCE(website, @website), domain = COALESCE(domain, @domain), social_url = COALESCE(social_url, @socialUrl),
            status = CASE WHEN status = 'no_website' AND @website IS NOT NULL THEN 'pending' ELSE status END
          WHERE id = @id`,
          { id: same.id, phone: b.phone, website: b.website, domain, socialUrl: b.socialUrl ?? null, ...gParams },
        ]);
      continue;
    }
    if (domain && known.some((k) => k.domain === domain)) continue; // chains / franchise locations
    if (b.email && known.some((k) => k.email === b.email)) continue;
    const status = b.email || b.website ? "pending" : "no_website";
    stmts.push([
      `INSERT OR IGNORE INTO businesses
        (search_id, source, source_id, name, category, category_confirmed, address, city, country_code, lat, lng, phone, website, domain, social_url,
         email, email_source, status, google_place_id, google_maps_url, google_type, google_types, rating, review_count, business_status, created_at)
      VALUES (@searchId, @source, @sourceId, @name, @category, @categoryConfirmed, @address, @city, @countryCode, @lat, @lng, @phone,
         @website, @domain, @socialUrl, @email, @emailSource, @status, @placeId, @mapsUrl, @gType, @gTypes, @rating, @reviewCount, @bStatus, @createdAt)`,
      {
        searchId,
        source,
        sourceId: b.sourceId,
        name: b.name,
        category: b.category,
        // OpenStreetMap tags are a real classification; Google leads say whether the search term was confirmed.
        categoryConfirmed: b.categoryConfirmed === false ? 0 : 1,
        address: b.address,
        city: b.city,
        countryCode: b.countryCode ?? fallbackCountry,
        lat: b.lat,
        lng: b.lng,
        phone: b.phone,
        website: b.website,
        domain,
        socialUrl: b.socialUrl ?? null,
        email: b.email,
        emailSource: b.email ? "osm-tag" : null,
        status,
        ...gParams,
        createdAt: now(),
      },
    ]);
    // Later items in this batch must see this one (same name nearby, same domain…).
    known.push({ id: -1, name: b.name, domain, lat: b.lat, lng: b.lng, google_place_id: g?.placeId ?? null, email: b.email, phone: b.phone });
  }
  // Flag chains: same exact name 3+ times across all leads, a shared website, or a repeated name root.
  stmts.push([CHAIN_BY_NAME_SQL]);
  for (const part of chunks(chainDomains)) stmts.push([`UPDATE businesses SET chain = 1 WHERE domain IN (${marks(part.length)})`, ...part]);
  for (const root of chainRoots) stmts.push(["UPDATE businesses SET chain = 1 WHERE search_id = ? AND lower(name) LIKE ?", searchId, `${root}%`]);
  if (skippedSharedPhone.length)
    await logEvent("info", `Search #${searchId}: skipped ${skippedSharedPhone.length} listing(s) sharing a phone with another lead: ${skippedSharedPhone.slice(0, 5).join("; ")}`);
  let inserted = 0;
  for (const part of chunks(stmts, 200)) {
    const rs = await db.batch(part);
    part.forEach(([sql], i) => {
      if (sql.trimStart().startsWith("INSERT")) inserted += rs[i].changes;
    });
  }
  return inserted;
}

async function isCancelled(id: number) {
  const row = await db.get<{ status: string }>("SELECT status FROM searches WHERE id = ?", id);
  return !row || row.status === "cancelled";
}

const SPARSE_HINT =
  "OpenStreetMap has few businesses with a website or email listed here. Try \"Any contact (phone counts)\", or use Google Places as the source.";

/**
 * Run (or continue) a search until `deadline`. Progress is saved after every step, so a search
 * over a whole country spans several background ticks. Returns true when the search is finished.
 */
export async function runSearch(searchId: number, deadline = Infinity): Promise<boolean> {
  const s = await db.get<SearchRow>("SELECT * FROM searches WHERE id = ?", searchId);
  if (!s || s.status === "cancelled" || s.status === "done") return true;
  const area = JSON.parse(s.area) as SearchArea;
  const categories = JSON.parse(s.categories) as string[];
  const contactMode = (s.require_website === 2 ? 2 : s.require_website === 0 ? 0 : 1) as ContactMode;
  const cur: Cursor = s.cursor ? JSON.parse(s.cursor) : {};
  const useGoogle = s.source === "google" || s.source === "both";
  const useOsm = s.source !== "google";
  const tiles = useOsm ? splitBbox(areaBbox(area)) : [];
  const googleSteps = useGoogle ? 1 : 0;
  const total = tiles.length + googleSteps;
  let found = s.found;
  const notes = cur.notes ?? [];

  const save = (status: string, done: number, error: string | null = null, finished: number | null = null) =>
    db.run(
      "UPDATE searches SET status = ?, tiles_total = ?, tiles_done = ?, found = ?, error = ?, finished_at = ?, cursor = ? WHERE id = ?",
      status,
      total,
      done,
      found,
      error,
      finished,
      JSON.stringify({ ...cur, notes }),
      searchId,
    );

  try {
    if (useGoogle && !(await googleKey())) throw new Error("Google Places API key is not set (Settings → Data sources).");
    await save("running", (cur.googleDone ? googleSteps : 0) + (cur.nextTile ?? 0));

    if (useGoogle && !cur.googleDone) {
      if (!categories.includes("all")) {
        try {
          const r = await googleSearch(area, categories, contactMode, {
            maxResults: s.max_results - found,
            isCancelled: () => isCancelled(searchId),
            startTerm: cur.googleTerm ?? 0,
            deadline,
            countryCode: s.country_code,
          });
          found += await insertBusinesses(searchId, r.businesses, "google", s.country_code);
          await logEvent("info", `Search #${searchId}: Google returned ${r.businesses.length} businesses (${r.requests} requests).`);
          if (!r.done) {
            cur.googleTerm = r.nextTerm;
            await save("running", 0);
            return false; // more search terms on the next tick
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!useOsm) throw e; // Google-only search: nothing else to fall back on
          notes.push(`Google: ${msg}`);
          await logEvent("warn", `Search #${searchId}: Google part failed: ${msg}`);
        }
      }
      cur.googleDone = true;
      await save("running", googleSteps);
    }

    for (let i = cur.nextTile ?? 0; i < tiles.length; i++) {
      if (await isCancelled(searchId)) return true;
      if (found >= s.max_results) break;
      if (Date.now() > deadline) return false; // continue on the next tick
      try {
        const list = await queryTile(area, tiles[i], categories, contactMode);
        found += await insertBusinesses(searchId, list.slice(0, s.max_results - found), "osm", s.country_code);
      } catch (e) {
        // Public Overpass servers get overloaded; skip this tile and keep going. "Retry" re-runs the search.
        cur.failedTiles = (cur.failedTiles ?? 0) + 1;
        cur.lastTileError = e instanceof Error ? e.message : String(e);
        await logEvent("warn", `Search #${searchId}: map tile ${i + 1}/${tiles.length} failed: ${cur.lastTileError}`);
      }
      cur.nextTile = i + 1;
      await save("running", googleSteps + i + 1);
      if (i + 1 < tiles.length) await sleep(1500); // be polite to the public Overpass servers
    }

    if (await isCancelled(searchId)) return true;
    const failed = cur.failedTiles ?? 0;
    if (useOsm && !useGoogle && tiles.length > 0 && failed === tiles.length)
      throw new Error(`OpenStreetMap servers are busy (${cur.lastTileError}). Try again in a few minutes.`);
    if (failed) notes.push(`${failed} of ${tiles.length} map tiles failed because the OpenStreetMap servers were busy. Press Retry to fill the gaps.`);
    const merged = await db.count("SELECT COUNT(*) FROM businesses WHERE search_id = ?", searchId);
    if (found === 0 && merged === 0 && failed === 0) notes.push(useGoogle ? "No matching businesses found. Try a wider area or other business types." : SPARSE_HINT);
    const note = notes.join(" ") || null;
    await save("done", total, note, now());
    await logEvent(notes.length ? "warn" : "info", `Search #${searchId} finished: ${found} new businesses${note ? ` (${note})` : ""}`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.run("UPDATE searches SET status = 'failed', error = ?, found = ?, finished_at = ? WHERE id = ?", msg, found, now(), searchId);
    await logEvent("error", `Search #${searchId} failed: ${msg}`);
    return true;
  }
}
