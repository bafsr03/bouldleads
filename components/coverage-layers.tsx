"use client";

import { useRouter } from "next/navigation";
import { Circle, CircleMarker, Pane, Polygon, Rectangle, TileLayer, Tooltip } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import { palette, useDark } from "./coverage-style";

export { palette, useDark };

// Map layers showing where we've searched and what each area yielded. Used inside a react-leaflet
// MapContainer on the Places page (full coverage map) and on Find leads (so you see what's covered).
//   searched with leads → app accent, stronger the more leads it gave
//   searched, nothing found → dark slate
//   not searched → optionally dimmed (mask with holes for every searched area)

export type { CoverageArea, CoveragePoint } from "./coverage-style";
import type { CoverageArea, CoveragePoint } from "./coverage-style";

const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESRI_ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

/**
 * Esri's neutral gray canvas basemap: dark in dark mode (water darkened to the page background in
 * globals.css), light in light mode. Its place names come separately in <MapNames />, drawn above our
 * shading so they stay readable.
 */
export function BaseTiles() {
  const isDark = useDark();
  return (
    <>
      <TileLayer
        key={isDark ? "dark" : "light"}
        className="bl-tiles"
        attribution={ESRI_ATTRIBUTION}
        url={`${ESRI}/${isDark ? "World_Dark_Gray_Base" : "World_Light_Gray_Base"}/MapServer/tile/{z}/{y}/{x}`}
        maxNativeZoom={16}
        maxZoom={19}
      />
      <MapNames isDark={isDark} />
    </>
  );
}

/** The basemap's own country, state and city names, in a pane above shading and heat (below markers). */
function MapNames({ isDark }: { isDark: boolean }) {
  return (
    <Pane name="bl-names" style={{ zIndex: 450, pointerEvents: "none" }}>
      <TileLayer
        key={isDark ? "dark-names" : "light-names"}
        url={`${ESRI}/${isDark ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference"}/MapServer/tile/{z}/{y}/{x}`}
        maxNativeZoom={16}
        maxZoom={19}
      />
    </Pane>
  );
}

// ---- geometry ------------------------------------------------------------------------------

/** Polygon ring for an area (circles as a 48-gon), used for the mask holes and bounds. */
export function ring(a: CoverageArea["area"]): LatLngTuple[] {
  if (a.type === "place") {
    const [s, w, n, e] = a.bbox;
    return [
      [s, w],
      [n, w],
      [n, e],
      [s, e],
    ];
  }
  const pts: LatLngTuple[] = [];
  const dLat = a.radiusKm / 111.32;
  const dLng = a.radiusKm / (111.32 * Math.max(0.01, Math.cos((a.lat * Math.PI) / 180)));
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * 2 * Math.PI;
    pts.push([a.lat + dLat * Math.sin(t), a.lng + dLng * Math.cos(t)]);
  }
  return pts;
}

const WORLD: LatLngTuple[] = [
  [-89.9, -720],
  [89.9, -720],
  [89.9, 720],
  [-89.9, 720],
];

// ---- layers --------------------------------------------------------------------------------

export function CoverageLayers({
  areas,
  points = [],
  dim = false,
  interactive = true,
}: {
  areas: CoverageArea[];
  points?: CoveragePoint[];
  dim?: boolean;
  interactive?: boolean;
}) {
  const router = useRouter();
  const c = palette(useDark());
  const max = Math.max(1, ...areas.map((a) => a.leads));
  const tierColor = (t: string | null) => (t === "A" ? c.accent : t === "B" ? c.tierB : t === "not_fit" ? c.unfit : c.tierC);

  return (
    <>
      {dim && areas.length > 0 && (
        <Polygon
          positions={[WORLD, ...areas.map((a) => ring(a.area))]}
          pathOptions={{ stroke: false, fillColor: c.mask, fillOpacity: c.maskOpacity, interactive: false }}
        />
      )}
      {areas.map((a) => {
        const running = a.status === "queued" || a.status === "running";
        const empty = !running && a.leads === 0;
        const strength = a.leads ? 0.1 + 0.3 * (Math.log(1 + a.leads) / Math.log(1 + max)) : 0;
        const style = empty
          ? { color: c.empty, weight: 1.5, dashArray: "4 4", fillColor: c.emptyFill, fillOpacity: 0.35 }
          : { color: c.accent, weight: running ? 2 : 1.5, dashArray: running ? "6 6" : undefined, fillColor: c.accent, fillOpacity: running ? 0.08 : strength };
        const tip = (
          <Tooltip sticky>
            <div className="text-xs leading-relaxed">
              <div className="font-semibold">{a.place ?? a.label}</div>
              <div className="opacity-70">
                #{a.id} · {a.label.split(" · ")[0]} · {new Date(a.created_at).toLocaleDateString()}
              </div>
              {running ? (
                <div>Searching…</div>
              ) : (
                <div>
                  {a.leads} leads · {a.good} tier A/B · {a.called} called · {a.booked} booked
                </div>
              )}
              {interactive && <div className="opacity-70">Click to open these leads</div>}
            </div>
          </Tooltip>
        );
        const handlers = interactive ? { click: () => router.push(`/leads?searchId=${a.id}`) } : undefined;
        return a.area.type === "circle" ? (
          <Circle key={a.id} center={[a.area.lat, a.area.lng]} radius={a.area.radiusKm * 1000} pathOptions={style} eventHandlers={handlers}>
            {tip}
          </Circle>
        ) : (
          <Rectangle
            key={a.id}
            bounds={[
              [a.area.bbox[0], a.area.bbox[1]],
              [a.area.bbox[2], a.area.bbox[3]],
            ]}
            pathOptions={style}
            eventHandlers={handlers}
          >
            {tip}
          </Rectangle>
        );
      })}
      {points.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={p.tier === "A" ? 5 : 4}
          pathOptions={{ color: c.surface, weight: 1, fillColor: tierColor(p.tier), fillOpacity: 0.95 }}
          eventHandlers={interactive ? { click: () => router.push(`/leads/${p.id}`) } : undefined}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            <span className="text-xs">
              {p.name}
              {p.tier && <span className="opacity-70"> · {p.tier === "not_fit" ? "not a fit" : `tier ${p.tier}`}</span>}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

