"use client";

import "leaflet/dist/leaflet.css";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, LatLngBoundsExpression } from "leaflet";
import { latLngBounds } from "leaflet";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Polygon, Tooltip, useMap, useMapEvents } from "react-leaflet";
import {
  WORLD,
  bboxOf,
  countryAt,
  inGeometry,
  loadRegions,
  unwrapGeometry,
  type CountryProps,
  type RegionFC,
  type RegionProps,
} from "./map-geo";
import { BaseTiles, ring } from "./coverage-layers";
import { HEAT_GRADIENT, binColor, palette, quantileBins, ramp, useDark, type CoverageArea } from "./coverage-style";
import type { HeatmapData } from "@/lib/heatmap";

// Live heat map with three levels:
//   world/continent  → countries shaded by the chosen metric (choropleth)
//   region/city      → one bubble per searched place
//   streets          → a density heat layer of the leads themselves, then individual lead dots

export type Metric = "leads" | "good" | "called" | "booked";
export type Layers = { countries: boolean; regions: boolean; places: boolean; heat: boolean; dots: boolean };

const ZOOM = { countriesMax: 4, regionsMin: 5, regionsMax: 11, placesMin: 4, placesMax: 7, heatMin: 6, dotsMin: 12 };
const STAGE_BOOKED = 5; // index of "booked" in STAGES (lib/call-outcomes.ts)

/** Heat weight of one lead for the selected metric. */
function weight(tier: number, stage: number, metric: Metric): number {
  if (metric === "good") return tier === 1 || tier === 2 ? 1 : 0;
  if (metric === "called") return stage !== 0 ? 1 : 0;
  if (metric === "booked") return stage === STAGE_BOOKED ? 1 : 0;
  return [0.5, 1, 0.7, 0.4, 0.15][tier] ?? 0.5; // not audited, A, B, C, not a fit
}

function ZoomWatch({ onZoom }: { onZoom: (z: number, b: LatLngBoundsExpression) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom(), map.getBounds()), moveend: () => onZoom(map.getZoom(), map.getBounds()) });
  useEffect(() => onZoom(map.getZoom(), map.getBounds()), [map, onZoom]);
  return null;
}

/** Fit to all leads once data first arrives, and whenever `fitKey` changes. */
function Fit({ data, fitKey }: { data: HeatmapData | undefined; fitKey: number }) {
  const map = useMap();
  const has = !!data?.points.length;
  useEffect(() => {
    if (!data) return;
    if (data.points.length) map.fitBounds(latLngBounds(data.points.map((p) => [p[0], p[1]] as [number, number])), { padding: [30, 30], maxZoom: 12 });
    else map.setView([15, -30], 2);
    // Only on first data and on explicit "fit" requests, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [has, fitKey, map]);
  return null;
}

/** Fly to a point when `to.key` changes (clicking a place in the side list). */
function FlyTo({ to }: { to: { lat: number; lng: number; zoom: number; key: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo([to.lat, to.lng], to.zoom, { duration: 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to?.key, map]);
  return null;
}

function ResizeOnShow() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
}

/** leaflet.heat attaches to the global L, so load it after exposing Leaflet on window. */
function HeatLayer({ points, metric, street }: { points: HeatmapData["points"]; metric: Metric; street: boolean }) {
  const map = useMap();
  useEffect(() => {
    let layer: Layer | undefined;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      (window as unknown as { L: typeof L }).L = L;
      await import("leaflet.heat");
      if (cancelled) return;
      const pts = points.map((p) => [p[0], p[1], weight(p[2], p[3], metric)] as [number, number, number]).filter((p) => p[2] > 0);
      // Saturation point grows with the amount of data, so only real clusters turn red. At street level the
      // heat gets tighter and lighter so the individual lead dots stay readable on top of it.
      const total = pts.reduce((a, p) => a + p[2], 0);
      const heat = (L as unknown as { heatLayer: (pts: [number, number, number][], o: object) => Layer }).heatLayer(pts, {
        radius: street ? 16 : 22,
        blur: street ? 14 : 20,
        maxZoom: 12,
        minOpacity: street ? 0.15 : 0.3,
        max: Math.max(1, Math.min(8, total / 120)),
        gradient: HEAT_GRADIENT,
      });
      layer = heat.addTo(map);
    })();
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, points, metric, street]);
  return null;
}

function CountriesLayer({ data, metric, isDark }: { data: HeatmapData; metric: Metric; isDark: boolean }) {
  const ref = useRef<LeafletGeoJSON | null>(null);
  const map = useMap();
  const byCc = useMemo(() => new Map(data.countries.map((c) => [c.cc, c])), [data.countries]);
  const bins = useMemo(() => quantileBins(data.countries.map((c) => Number(c[metric]))), [data.countries, metric]);
  const r = ramp(isDark);

  const style = (f?: Feature<Geometry, CountryProps>) => {
    const v = Number(byCc.get(f?.properties.cc ?? "")?.[metric] ?? 0);
    return { fillColor: binColor(v, bins, isDark), fillOpacity: v ? 0.85 : 0.55, color: r.line, weight: 0.6 };
  };

  // Restyle and refresh tooltips in place on every poll (no re-mount).
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    layer.setStyle(style as never);
    layer.eachLayer((l) => {
      const f = (l as unknown as { feature: Feature<Geometry, CountryProps> }).feature;
      const c = byCc.get(f.properties.cc ?? "");
      l.setTooltipContent(
        `<b>${f.properties.name}</b><br/>${c ? `${c.leads} leads · ${c.good} tier A/B<br/>${c.called} called · ${c.booked} booked` : "Not searched yet"}`,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byCc, bins, metric, isDark]);

  return (
    <GeoJSON
      ref={ref}
      data={WORLD}
      style={style as never}
      onEachFeature={(f: Feature<Geometry, CountryProps>, layer) => {
        layer.bindTooltip("", { sticky: true });
        layer.on({
          mouseover: () => (layer as unknown as { setStyle: (s: object) => void }).setStyle({ weight: 2, color: palette(isDark).accent }),
          mouseout: () => ref.current?.resetStyle(layer),
          click: () => map.fitBounds((layer as unknown as { getBounds: () => LatLngBoundsExpression }).getBounds(), { padding: [20, 20] }),
        });
      }}
    />
  );
}

// ---- regions (states, departamentos…) ------------------------------------------------------

export type RegionStat = Counts & { name: string };
type Counts = { leads: number; good: number; called: number; booked: number };

/** Leads per region, for every country that has leads plus the one in the middle of the map. */
function useRegionStats(data: HeatmapData, enabled: boolean, center: { lat: number; lng: number } | null) {
  const here = useMemo(() => (center ? countryAt(center.lat, center.lng) : null), [center]);
  const ccs = useMemo(
    () => [...new Set([...data.countries.filter((c) => c.leads > 0).map((c) => c.cc), ...(here ? [here] : [])])].sort().join(","),
    [data.countries, here],
  );
  const [fcs, setFcs] = useState<RegionFC[]>([]);
  useEffect(() => {
    if (!enabled || !ccs) return;
    let cancelled = false;
    Promise.all(ccs.split(",").map(loadRegions)).then((all) => !cancelled && setFcs(all));
    return () => {
      cancelled = true;
    };
  }, [ccs, enabled]);

  const features = useMemo(() => fcs.flatMap((fc) => fc.features), [fcs]);
  const stats = useMemo(() => {
    const boxes = features.map((f) => bboxOf(f.geometry));
    const out: RegionStat[] = features.map((f) => ({ name: f.properties.name, leads: 0, good: 0, called: 0, booked: 0 }));
    for (const [lat, lng, tier, stage] of data.points) {
      for (let i = 0; i < features.length; i++) {
        const [w, s, e, n] = boxes[i];
        if (lng < w || lng > e || lat < s || lat > n || !inGeometry(lng, lat, features[i].geometry)) continue;
        const r = out[i];
        r.leads++;
        if (tier === 1 || tier === 2) r.good++;
        if (stage !== 0) r.called++;
        if (stage === STAGE_BOOKED) r.booked++;
        break;
      }
    }
    return out;
  }, [features, data.points]);
  return { features, stats };
}

function RegionsLayer({
  features,
  stats,
  metric,
  isDark,
}: {
  features: Feature<Geometry, RegionProps>[];
  stats: RegionStat[];
  metric: Metric;
  isDark: boolean;
}) {
  const ref = useRef<LeafletGeoJSON | null>(null);
  const map = useMap();
  const fc = useMemo<RegionFC>(
    () => ({ type: "FeatureCollection", features: features.map((f, i) => ({ ...f, id: i, geometry: unwrapGeometry(f.geometry) })) }),
    [features],
  );
  const bins = useMemo(() => quantileBins(stats.map((r) => r[metric])), [stats, metric]);
  const r = ramp(isDark);
  const style = (f?: Feature<Geometry, RegionProps>) => {
    const v = stats[Number(f?.id)]?.[metric] ?? 0;
    return { fillColor: binColor(v, bins, isDark), fillOpacity: v ? 0.6 : 0.2, color: r.line, weight: 1.1, opacity: 0.9 };
  };

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    layer.setStyle(style as never);
    layer.eachLayer((l) => {
      const f = (l as unknown as { feature: Feature<Geometry, RegionProps> }).feature;
      const st = stats[Number(f.id)];
      l.setTooltipContent(
        `<b>${f.properties.name}</b><br/>${st?.leads ? `${st.leads} leads · ${st.good} tier A/B<br/>${st.called} called · ${st.booked} booked` : "No leads here yet"}`,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, bins, metric, isDark]);

  if (!features.length) return null;
  return (
    <GeoJSON
      key={features.length}
      ref={ref}
      data={fc}
      style={style as never}
      onEachFeature={(f: Feature<Geometry, RegionProps>, layer) => {
        layer.bindTooltip("", { sticky: true });
        layer.on({
          mouseover: () => (layer as unknown as { setStyle: (s: object) => void }).setStyle({ weight: 2.5, color: palette(isDark).accent }),
          mouseout: () => ref.current?.resetStyle(layer),
          click: () => map.fitBounds((layer as unknown as { getBounds: () => LatLngBoundsExpression }).getBounds(), { padding: [20, 20] }),
        });
      }}
    />
  );
}

function PlaceBubbles({ data, metric, isDark }: { data: HeatmapData; metric: Metric; isDark: boolean }) {
  const router = useRouter();
  const bins = quantileBins(data.places.map((p) => Number(p[metric])));
  const max = Math.max(1, ...data.places.map((p) => Number(p[metric])));
  const c = palette(isDark);
  return (
    <>
      {data.places.map((p) => {
        const v = Number(p[metric]);
        return (
          <CircleMarker
            key={p.place}
            center={[p.lat, p.lng]}
            radius={8 + 26 * Math.sqrt(v / max)}
            pathOptions={{ color: c.surface, weight: 1.5, fillColor: binColor(v, bins, isDark), fillOpacity: v ? 0.75 : 0.4 }}
            eventHandlers={{ click: () => router.push(`/leads?place=${encodeURIComponent(p.place)}`) }}
          >
            <Tooltip direction="top">
              <div className="text-xs leading-relaxed">
                <b>{p.place}</b>
                <div>
                  {p.leads} leads · {p.good} tier A/B
                </div>
                <div>
                  {p.called} called · {p.booked} booked
                </div>
                <div className="opacity-70">Click to open these leads</div>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

/** Thin outlines of searched areas; empty ones darkened, so you can see where we looked and found nothing. */
function AreaOutlines({ areas, isDark }: { areas: CoverageArea[]; isDark: boolean }) {
  const c = palette(isDark);
  return (
    <>
      {areas.map((a) => {
        const empty = a.status === "done" && a.leads === 0;
        return (
          <Polygon
            key={a.id}
            positions={ring(a.area)}
            interactive={false}
            pathOptions={{
              color: empty ? c.empty : c.accent,
              weight: 1.2,
              dashArray: "5 5",
              fill: empty,
              fillColor: c.emptyFill,
              fillOpacity: empty ? 0.45 : 0,
            }}
          />
        );
      })}
    </>
  );
}

function LeadDots({ data, bounds, isDark }: { data: HeatmapData; bounds: LatLngBoundsExpression | null; isDark: boolean }) {
  const router = useRouter();
  const c = palette(isDark);
  const b = bounds ? latLngBounds(bounds as never) : null;
  const visible = b ? data.points.filter((p) => b.contains([p[0], p[1]])).slice(0, 1500) : [];
  const color = (t: number) => (t === 1 ? c.accent : t === 2 ? c.tierB : t === 4 ? c.unfit : c.tierC);
  return (
    <>
      {visible.map((p) => (
        <CircleMarker
          key={p[4]}
          center={[p[0], p[1]]}
          radius={p[2] === 1 ? 6 : 5}
          pathOptions={{ color: c.surface, weight: 1.5, fillColor: color(p[2]), fillOpacity: 1 }}
          eventHandlers={{ click: () => router.push(`/leads/${p[4]}`) }}
        />
      ))}
    </>
  );
}

// ---- labels ----------------------------------------------------------------------------------
// Our own names on top of the shading (the tiles' names sit underneath it and turn dark in dark mode).

export default function HeatMap({
  data,
  areas,
  metric,
  layers,
  fitKey,
  flyTo = null,
  onZoom,
  onRegions,
  className = "h-[560px] w-full",
}: {
  data: HeatmapData | undefined;
  areas: CoverageArea[];
  metric: Metric;
  layers: Layers;
  fitKey: number;
  flyTo?: { lat: number; lng: number; zoom: number; key: number } | null;
  onZoom?: (zoom: number) => void;
  onRegions?: (stats: RegionStat[]) => void;
  className?: string;
}) {
  const isDark = useDark();
  const [zoom, setZoom] = useState(2);
  const [bounds, setBounds] = useState<LatLngBoundsExpression | null>(null);
  // See area-map.tsx: rebuild the map after Next.js hides and shows the page.
  const [instance, setInstance] = useState(0);
  useLayoutEffect(() => () => setInstance((i) => i + 1), []);
  const handleZoom = useCallback(
    (z: number, b: LatLngBoundsExpression) => {
      setZoom(z);
      setBounds(b);
      onZoom?.(z);
    },
    [onZoom],
  );

  return (
    <MapContainer key={instance} center={[15, -30]} zoom={2} minZoom={2} className={className} worldCopyJump preferCanvas>
      <ResizeOnShow />
      <BaseTiles />
      <ZoomWatch onZoom={handleZoom} />
      <Fit data={data} fitKey={fitKey} />
      <FlyTo to={flyTo} />
      {data && layers.countries && zoom <= ZOOM.countriesMax && <CountriesLayer data={data} metric={metric} isDark={isDark} />}
      {data && layers.regions && zoom >= ZOOM.regionsMin && zoom <= ZOOM.regionsMax && (
        <Regions data={data} metric={metric} isDark={isDark} onStats={onRegions} bounds={bounds} />
      )}
      {zoom >= ZOOM.placesMin && <AreaOutlines areas={areas} isDark={isDark} />}
      {data && layers.heat && zoom >= ZOOM.heatMin && <HeatLayer points={data.points} metric={metric} street={zoom >= ZOOM.dotsMin} />}
      {data && layers.places && zoom >= ZOOM.placesMin && zoom <= ZOOM.placesMax && <PlaceBubbles data={data} metric={metric} isDark={isDark} />}
      {data && layers.dots && zoom >= ZOOM.dotsMin && <LeadDots data={data} bounds={bounds} isDark={isDark} />}
    </MapContainer>
  );
}

function Regions({
  data,
  metric,
  isDark,
  onStats,
  bounds,
}: {
  data: HeatmapData;
  metric: Metric;
  isDark: boolean;
  onStats?: (s: RegionStat[]) => void;
  bounds: LatLngBoundsExpression | null;
}) {
  // Re-evaluated only when the map centre moves to a different ~0.5° cell, not on every pixel of a pan.
  const c = bounds ? latLngBounds(bounds as never).getCenter() : null;
  const cell = c ? `${Math.round(c.lat * 2) / 2},${Math.round(c.lng * 2) / 2}` : "";
  const center = useMemo(() => (cell ? { lat: Number(cell.split(",")[0]), lng: Number(cell.split(",")[1]) } : null), [cell]);
  const { features, stats } = useRegionStats(data, true, center);
  useEffect(() => onStats?.(stats), [stats, onStats]);
  return <RegionsLayer features={features} stats={stats} metric={metric} isDark={isDark} />;
}

export { ZOOM as HEAT_ZOOM };
