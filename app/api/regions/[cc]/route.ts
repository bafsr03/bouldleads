import { connection } from "next/server";
import countries from "i18n-iso-countries";
import { bad, json } from "@/lib/api";
import { cached } from "@/lib/discovery/google-api";
import { fetchWithTimeout } from "@/lib/discovery/http";

// First-level regions of a country (US states, Peru's departamentos, …) for the heat map, from
// geoBoundaries (public domain). Fetched once per country, slimmed down and cached in the database.

type GbFeature = { type: "Feature"; properties: { shapeName?: string; shapeISO?: string }; geometry: { type: string; coordinates: unknown } };

const round = (c: unknown): unknown => (Array.isArray(c) ? (typeof c[0] === "number" ? c.map((n: number) => Math.round(n * 1e4) / 1e4) : c.map(round)) : c);

async function load(iso3: string) {
  const meta = await fetchWithTimeout(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`, { timeoutMs: 20000 });
  if (!meta.ok) throw new Error(`geoBoundaries ${meta.status}`);
  const url = ((await meta.json()) as { simplifiedGeometryGeoJSON?: string }).simplifiedGeometryGeoJSON;
  if (!url) throw new Error("No region boundaries for this country");
  const res = await fetchWithTimeout(url, { timeoutMs: 30000 });
  if (!res.ok) throw new Error(`geoBoundaries file ${res.status}`);
  const fc = (await res.json()) as { features: GbFeature[] };
  return {
    type: "FeatureCollection" as const,
    features: fc.features.map((f) => ({
      type: "Feature" as const,
      properties: { name: f.properties.shapeName ?? "", iso: f.properties.shapeISO ?? null },
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
    })),
  };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/regions/[cc]">) {
  await connection();
  const cc = (await ctx.params).cc.toUpperCase();
  const iso3 = countries.alpha2ToAlpha3(cc);
  if (!iso3) return bad("Unknown country", 404);
  try {
    const fc = await cached(`adm1:${iso3}`, 180 * 86_400_000, () => load(iso3));
    return Response.json(fc, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    return json({ type: "FeatureCollection", features: [], error: e instanceof Error ? e.message : String(e) });
  }
}
