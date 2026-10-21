import { connection } from "next/server";
import { db, now, placeFromLabel } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { getSecret } from "@/lib/settings";
import { bad, body, int, json } from "@/lib/api";
import { describeSelection, isValidToken } from "@/lib/discovery/categories";
import { reversePlace } from "@/lib/discovery/nominatim";
import type { SearchArea } from "@/lib/discovery/overpass";

export async function GET() {
  await connection();
  const rows = await db.all(
    `SELECT s.*, (SELECT COUNT(*) FROM businesses b WHERE b.search_id = s.id AND b.status = 'verified') AS verified,
            (SELECT COUNT(*) FROM businesses b WHERE b.search_id = s.id AND b.status = 'pending') AS pending,
            (SELECT COUNT(*) FROM businesses b WHERE b.search_id = s.id) AS leads
     FROM searches s ORDER BY s.id DESC LIMIT 100`,
  );
  return json(rows);
}

type NewSearch = {
  area: SearchArea;
  categories: string[];
  source?: "osm" | "google" | "both";
  countryCode?: string | null;
  requireWebsite?: boolean; // legacy
  contactMode?: 0 | 1 | 2; // 1 = website or email, 2 = any contact (phone counts), 0 = none
  maxResults?: number;
};

export async function POST(req: Request) {
  const b = await body<NewSearch>(req);
  if (!b.area || !["circle", "place"].includes(b.area.type)) return bad("Pick an area on the map or search for a place.");
  const categories = [...new Set((b.categories ?? []).map((c) => String(c).trim()).filter(isValidToken))].slice(0, 200);
  if (categories.length === 0) return bad("Pick at least one business type.");
  const source = b.source === "google" || b.source === "both" ? b.source : "osm";
  if (source === "google" && categories.includes("all")) return bad("Google Places needs specific business types. \"All businesses\" works with OpenStreetMap.");
  if (source !== "osm" && !(await getSecret("googlePlacesApiKey"))) return bad("Add a Google Places API key in Settings first.");
  const contactMode = b.contactMode === 0 || b.contactMode === 2 ? b.contactMode : b.requireWebsite === false ? 0 : 1;
  if (b.area.type === "circle" && (b.area.radiusKm <= 0 || b.area.radiusKm > 300)) return bad("Radius must be 1–300 km.");

  let country = b.countryCode?.toUpperCase() ?? null;
  // "City, Country": groups searches on the Places page.
  let place: string | null = null;
  if (b.area.type === "place") {
    place = placeFromLabel(b.area.label);
  } else {
    const r = await reversePlace(b.area.lat, b.area.lng).catch(() => null);
    country ??= r?.countryCode ?? null;
    place = r?.place ?? null;
  }

  const where =
    b.area.type === "place"
      ? b.area.label.split(",").slice(0, 2).join(",")
      : b.area.label ?? `${b.area.radiusKm} km around ${b.area.lat.toFixed(3)}, ${b.area.lng.toFixed(3)}`;
  const what = describeSelection(categories);
  const label = `${what.length > 60 ? `${categories.length} business types` : what} · ${where}`;
  const r = await db.run(
    `INSERT INTO searches (label, place, source, area, categories, country_code, require_website, max_results, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    label,
    place ?? where,
    source,
    JSON.stringify(b.area),
    JSON.stringify(categories),
    country,
    contactMode,
    Math.min(Math.max(int(b.maxResults, 5000), 10), 100_000),
    now(),
  );
  const id = r.lastId;
  await enqueue("search", { searchId: id });
  return json({ id });
}
