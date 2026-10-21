"use client";

import { useSyncExternalStore } from "react";

// Coverage map colors, legend and types. Kept free of Leaflet so pages can import them on the server.

export type CoverageArea = {
  id: number;
  label: string;
  place: string | null;
  status: string;
  created_at: number;
  leads: number;
  good: number;
  called: number;
  booked: number;
  area: { type: "circle"; lat: number; lng: number; radiusKm: number } | { type: "place"; bbox: [number, number, number, number] };
};

export type CoveragePoint = { id: number; name: string; lat: number; lng: number; tier: string | null; stage: string };

// ---- theme ---------------------------------------------------------------------------------

const dark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const subscribeTheme = (cb: () => void) => {
  const m = window.matchMedia("(prefers-color-scheme: dark)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export const useDark = () => useSyncExternalStore(subscribeTheme, dark, () => false);

/** Colors that follow the app's CSS tokens (globals.css), light and dark. */
export function palette(isDark: boolean) {
  return isDark
    ? { accent: "#4fb89c", empty: "#94a3b8", emptyFill: "#020617", mask: "#000000", maskOpacity: 0.5, surface: "#17181a", tierB: "#38bdf8", tierC: "#a1a1aa", unfit: "#52525b" }
    : { accent: "#1f6f5c", empty: "#475569", emptyFill: "#1e293b", mask: "#0f172a", maskOpacity: 0.28, surface: "#ffffff", tierB: "#0284c7", tierC: "#71717a", unfit: "#d4d4d8" };
}

export function CoverageLegend({ points }: { points: boolean }) {
  const c = palette(useDark());
  const sw = (bg: string, border: string, dashed = false, round = false) => (
    <span
      className={round ? "inline-block h-2.5 w-2.5 rounded-full" : "inline-block h-3 w-4 rounded-sm"}
      style={{ background: bg, border: `1.5px ${dashed ? "dashed" : "solid"} ${border}` }}
    />
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        {sw(`${c.accent}66`, c.accent)} Searched: leads found (darker = more)
      </span>
      <span className="inline-flex items-center gap-1.5">
        {sw(`${c.emptyFill}88`, c.empty, true)} Searched: nothing found
      </span>
      <span className="inline-flex items-center gap-1.5">
        {sw("transparent", c.accent, true)} Searching now
      </span>
      {points && (
        <>
          <span className="inline-flex items-center gap-1.5">
            {sw(c.accent, c.surface, false, true)} Tier A
          </span>
          <span className="inline-flex items-center gap-1.5">
            {sw(c.tierB, c.surface, false, true)} Tier B
          </span>
          <span className="inline-flex items-center gap-1.5">
            {sw(c.tierC, c.surface, false, true)} Tier C / not audited
          </span>
        </>
      )}
    </div>
  );
}

// ---- heat map scales -------------------------------------------------------------------------

/** 5-step sequential ramp of the accent hue: light → dark on light maps, dark → bright on dark maps. */
export function ramp(isDark: boolean) {
  return isDark
    ? { steps: ["#16302a", "#1d4a3e", "#287258", "#3b9f7f", "#6fd4b3"], none: "#26272b", line: "#5d6068" }
    : { steps: ["#d8eee7", "#a6d6c7", "#6cb8a2", "#36917a", "#1f6f5c"], none: "#ececeb", line: "#c9c9c7" };
}

/** Upper bounds of 5 quantile bins over the non-zero values. */
export function quantileBins(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [1, 1, 1, 1, 1];
  return [0.2, 0.4, 0.6, 0.8, 1].map((q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)]);
}

export function binColor(value: number, bins: number[], isDark: boolean): string {
  const r = ramp(isDark);
  if (!value) return r.none;
  const i = bins.findIndex((b) => value <= b);
  return r.steps[i === -1 ? 4 : i];
}

/** Heat colours: the app accent for scattered leads, warming to red where they cluster. */
export const HEAT_GRADIENT = { 0.2: "#1f6f5c", 0.45: "#4fb89c", 0.65: "#facc15", 0.82: "#f97316", 1: "#ef4444" };

export function HeatLegend({ bins, metricLabel }: { bins: number[]; metricLabel: string }) {
  const isDark = useDark();
  const r = ramp(isDark);
  const unique = bins.every((b) => b === bins[0]);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <span className="inline-flex items-center gap-2">
        <span>{metricLabel}</span>
        <span className="inline-flex overflow-hidden rounded-sm">
          <span className="h-3 w-5" style={{ background: r.none }} title="None" />
          {r.steps.map((c, i) => (
            <span key={c} className="h-3 w-5" style={{ background: c }} title={unique ? `${bins[0]}` : `up to ${bins[i]}`} />
          ))}
        </span>
        <span className="tabular-nums">0 → {bins[4]}</span>
      </span>
      <span className="inline-flex items-center gap-2">
        Hot spots
        <span
          className="h-3 w-24 rounded-sm"
          style={{ background: `linear-gradient(90deg, ${Object.values(HEAT_GRADIENT).join(", ")})` }}
        />
      </span>
    </div>
  );
}
