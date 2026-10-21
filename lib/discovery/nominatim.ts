import { fetchWithTimeout, sleep } from "./http";

// Nominatim usage policy: max 1 request/second, identifying User-Agent.
let lastCall = 0;

export type Place = {
  label: string;
  type: string; // city, country, state, …
  countryCode: string | null;
  lat: number;
  lng: number;
  bbox: [number, number, number, number]; // south, west, north, east
  osmType: string;
  osmId: number;
  areaId: number | null; // Overpass area id, if the place is a relation/way polygon
};

export async function geocode(q: string): Promise<Place[]> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  const res = await fetchWithTimeout(url.toString(), { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = (await res.json()) as Array<{
    display_name: string;
    addresstype?: string;
    type: string;
    lat: string;
    lon: string;
    boundingbox: [string, string, string, string];
    osm_type: string;
    osm_id: number;
    address?: { country_code?: string };
  }>;
  return rows.map((r) => {
    // Nominatim's boundingbox is [minLat, maxLat, minLon, maxLon]; we use [south, west, north, east].
    const [s, n, w, e] = r.boundingbox.map(Number);
    return {
      label: r.display_name,
      type: r.addresstype ?? r.type,
      countryCode: r.address?.country_code?.toUpperCase() ?? null,
      lat: Number(r.lat),
      lng: Number(r.lon),
      bbox: [s, w, n, e] as [number, number, number, number],
      osmType: r.osm_type,
      osmId: r.osm_id,
      // Overpass derives area ids from relations (+3.6e9) and closed ways (+2.4e9).
      areaId: r.osm_type === "relation" ? 3600000000 + r.osm_id : r.osm_type === "way" ? 2400000000 + r.osm_id : null,
    };
  });
}

/** Country and "City, Country" for a point (used to group radius searches into places). */
export async function reversePlace(lat: number, lng: number): Promise<{ countryCode: string | null; place: string | null }> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lng}`;
  const res = await fetchWithTimeout(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) return { countryCode: null, place: null };
  const j = (await res.json()) as {
    address?: { country_code?: string; country?: string; city?: string; town?: string; municipality?: string; county?: string; state?: string };
  };
  const a = j.address ?? {};
  const city = a.city ?? a.town ?? a.municipality ?? a.county ?? a.state;
  return {
    countryCode: a.country_code?.toUpperCase() ?? null,
    place: [city, a.country].filter(Boolean).join(", ") || null,
  };
}
