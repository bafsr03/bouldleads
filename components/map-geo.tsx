"use client";

import type { FeatureCollection, Geometry } from "geojson";
import countries from "i18n-iso-countries";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldTopo from "world-atlas/countries-110m.json";

// Shared map geography: world country shapes, first-level regions (states, departamentos),
// and point-in-polygon helpers.

export type CountryProps = { name: string; cc: string | null };

/** Rings that cross the 180° meridian (Fiji, Russia's far east) would be drawn as a line across the
 *  whole map; shift their western points by +360° so they stay in one piece. */
function unwrap(ring: number[][]): number[][] {
  let crosses = false;
  for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) crosses = true;
  return crosses ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
}

export function unwrapGeometry(g: Geometry): Geometry {
  if (g.type === "Polygon") return { ...g, coordinates: g.coordinates.map(unwrap) };
  if (g.type === "MultiPolygon") return { ...g, coordinates: g.coordinates.map((p) => p.map(unwrap)) };
  return g;
}

// Country shapes (Natural Earth 1:110m), keyed by ISO alpha-2 to match businesses.country_code.
export const WORLD: FeatureCollection<Geometry, CountryProps> = (() => {
  const topo = worldTopo as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      geometry: unwrapGeometry(f.geometry),
      properties: { name: f.properties?.name ?? "", cc: f.id != null ? (countries.numericToAlpha2(String(f.id)) ?? null) : null },
    })),
  };
})();

export type RegionProps = { name: string; iso: string | null };
export type RegionFC = FeatureCollection<Geometry, RegionProps>;
// One request per country per page load; the server caches the boundaries for months.
const regionCache = new Map<string, Promise<RegionFC>>();
export function loadRegions(cc: string): Promise<RegionFC> {
  let p = regionCache.get(cc);
  if (!p) {
    p = fetch(`/api/regions/${cc}`)
      .then((r) => r.json() as Promise<RegionFC>)
      .catch(() => ({ type: "FeatureCollection", features: [] }) as RegionFC);
    regionCache.set(cc, p);
  }
  return p;
}

/** Ray casting: is (x=lng, y=lat) inside the ring? */
export function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inGeometry(x: number, y: number, g: Geometry): boolean {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((rings) => inRing(x, y, rings[0] as number[][]) && !rings.slice(1).some((h) => inRing(x, y, h as number[][])));
}

export function bboxOf(g: Geometry): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  walk((g as { coordinates?: unknown }).coordinates);
  return [w, s, e, n];
}

/** The country under a point, from the world shapes (null over the sea). */
export function countryAt(lat: number, lng: number): string | null {
  const x = lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng;
  for (const f of WORLD.features) {
    if (!f.properties.cc) continue;
    if (inGeometry(x, lat, f.geometry) || inGeometry(x + 360, lat, f.geometry)) return f.properties.cc;
  }
  return null;
}
