"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useLayoutEffect, useState } from "react";
import { Circle, MapContainer, Rectangle, useMap, useMapEvents } from "react-leaflet";
import { BaseTiles, CoverageLayers, palette, useDark, type CoverageArea } from "./coverage-layers";

export type MapArea =
  | { type: "circle"; lat: number; lng: number; radiusKm: number }
  | { type: "place"; bbox: [number, number, number, number] };

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)) });
  return null;
}

function FitTo({ area }: { area: MapArea | null }) {
  const map = useMap();
  useEffect(() => {
    if (!area) return;
    if (area.type === "place") {
      const [s, w, n, e] = area.bbox;
      map.fitBounds([
        [s, w],
        [n, e],
      ]);
    } else {
      const d = area.radiusKm / 111;
      map.fitBounds([
        [area.lat - d, area.lng - d * 1.4],
        [area.lat + d, area.lng + d * 1.4],
      ]);
    }
    // Only refit when the area identity changes, not on every radius tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area?.type, area?.type === "place" ? area.bbox.join() : area ? `${area.lat},${area.lng}` : ""]);
  return null;
}

/** A map created while its page was hidden has zero size; fix it once visible. */
function ResizeOnShow() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
  }, [map]);
  return null;
}

export default function AreaMap({
  area,
  onPick,
  coverage = [],
}: {
  area: MapArea | null;
  onPick: (lat: number, lng: number) => void;
  coverage?: CoverageArea[]; // earlier searches, drawn underneath so you see what's covered
}) {
  const accent = palette(useDark()).accent;
  const color = { color: accent, weight: 2.5, fillColor: accent, fillOpacity: 0.08, dashArray: "8 6" };
  // Next.js keeps visited pages alive in a hidden <Activity>. Hiding runs effect cleanups, and
  // react-leaflet's MapContainer destroys its Leaflet map there but keeps the stale instance.
  // Changing the key whenever we're hidden (or Strict-Mode remounted) builds a fresh map instead.
  const [instance, setInstance] = useState(0);
  useLayoutEffect(() => () => setInstance((i) => i + 1), []);
  return (
    <MapContainer key={instance} center={[30.27, -97.74]} zoom={4} className="h-[420px] w-full" worldCopyJump>
      <ResizeOnShow />
      <BaseTiles />
      <CoverageLayers areas={coverage} interactive={false} />
      <ClickHandler onClick={onPick} />
      <FitTo area={area} />
      {area?.type === "circle" && <Circle center={[area.lat, area.lng]} radius={area.radiusKm * 1000} pathOptions={color} />}
      {area?.type === "place" && (
        <Rectangle
          bounds={[
            [area.bbox[0], area.bbox[1]],
            [area.bbox[2], area.bbox[3]],
          ]}
          pathOptions={color}
        />
      )}
    </MapContainer>
  );
}
