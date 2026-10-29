"use client";

import { Expand, LocateFixed, Minimize, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Card, cx, fmt } from "./ui";
import { useApi } from "./use-api";
import { useEmailOn } from "./use-flags";
import { LineChart, Sparkline, StackedBar } from "./charts";
import { HeatLegend, quantileBins, type CoverageArea } from "./coverage-style";
import { STAGES } from "@/lib/call-outcomes";
import type { HeatmapData } from "@/lib/heatmap";
import type { Layers, Metric, RegionStat } from "./heat-map";

const HeatMap = dynamic(() => import("./heat-map"), {
  ssr: false,
  loading: () => <div className="h-full min-h-[420px] w-full animate-pulse rounded-xl bg-background" />,
});

const METRICS: { value: Metric; label: string; short: string }[] = [
  { value: "leads", label: "Leads found", short: "Leads" },
  { value: "good", label: "Tier A + B leads", short: "Good leads" },
  { value: "called", label: "Leads called", short: "Called" },
  { value: "booked", label: "Booked & won", short: "Booked" },
];

const LAYERS: { key: keyof Layers; label: string; hint: string }[] = [
  { key: "countries", label: "Countries", hint: "Zoomed out: countries shaded by the metric" },
  { key: "regions", label: "States", hint: "Zoomed in: states, provinces and departamentos shaded by the metric" },
  { key: "places", label: "Places", hint: "Region zoom: one bubble per searched place" },
  { key: "heat", label: "Heat", hint: "Hot spots where leads cluster" },
  { key: "dots", label: "Leads", hint: "Street zoom: every lead, coloured by tier" },
];

// Fixed colours by meaning (not by rank), so a stage keeps its colour as counts change.
const STAGE_COLOR: Record<string, string> = {
  new: "#94a3b8",
  callback: "#f59e0b",
  replied: "#10b981",
  followup: "#0ea5e9",
  recall: "#fb923c",
  booked: "var(--accent)",
  closed: "#ef4444",
};

const subscribeFs = (cb: () => void) => {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
};
const useFullscreen = () => useSyncExternalStore(subscribeFs, () => !!document.fullscreenElement, () => false);

const subscribeSecond = (cb: () => void) => {
  const t = setInterval(cb, 1000);
  return () => clearInterval(t);
};
const useSecond = () => useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => 0);

function Kpi({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: number[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
      {trend && <Sparkline values={trend} className="mt-2" />}
    </div>
  );
}

function levelFor(zoom: number) {
  if (zoom >= 12) return "Street level: individual leads and hot spots";
  if (zoom >= 8) return "City level: hot spots, over the state or departamento";
  if (zoom >= 5) return "Region level: states and departamentos shaded by the metric";
  return "World level: countries shaded by the metric. Zoom in for states and hot spots";
}

export function LiveDashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { data, reload } = useApi<HeatmapData>("/api/heatmap", 15_000);
  const { data: cov, reload: reloadAreas } = useApi<{ areas: CoverageArea[] }>("/api/coverage?bbox=0,0,0,0", 30_000);
  const [metric, setMetric] = useState<Metric>("leads");
  const [layers, setLayers] = useState<Layers>({ countries: true, regions: true, places: true, heat: true, dots: true });
  const [fitKey, setFitKey] = useState(0);
  const [fly, setFly] = useState<{ lat: number; lng: number; zoom: number; key: number } | null>(null);
  const [zoom, setZoom] = useState(2);
  const [regionStats, setRegionStats] = useState<RegionStat[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen();
  const emailOn = useEmailOn();
  const second = useSecond();

  useEffect(() => {
    if (refreshKey) {
      reload();
      reloadAreas();
    }
  }, [refreshKey, reload, reloadAreas]);

  const m = METRICS.find((x) => x.value === metric)!;
  const days = data?.days ?? [];
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const k = data?.kpis;
  const age = data && second ? Math.max(0, second - Math.floor(data.updatedAt / 1000)) : null;
  // The legend follows whatever is shaded at this zoom: countries, then states/departamentos.
  const bins = quantileBins(
    zoom <= 4 || !layers.regions ? (data?.countries ?? []).map((c) => Number(c[metric])) : regionStats.map((r) => r[metric]),
  );
  const topPlaces = [...(data?.places ?? [])].sort((a, b) => Number(b[metric]) - Number(a[metric])).slice(0, 8);

  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen());

  return (
    <div ref={box} className={cx(fullscreen && "overflow-y-auto bg-background p-6")}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Places</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live · {age === null ? "loading…" : age < 5 ? "just updated" : `updated ${age}s ago`} · refreshes every 15 s
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={toggleFullscreen} title="Monitor mode for a wall screen">
            {fullscreen ? <Minimize size={14} /> : <Expand size={14} />} {fullscreen ? "Exit full screen" : "Full screen"}
          </Button>
          {!fullscreen && (
            <Link href="/search">
              <Button variant="primary">
                <Plus size={14} /> New search
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Leads" value={fmt(k?.leads)} sub={`${fmt(days.at(-1)?.leads)} found today`} trend={days.map((d) => d.leads)} />
        <Kpi label="Tier A + B" value={fmt(k?.good)} sub={k?.leads ? `${Math.round(((k.good ?? 0) / k.leads) * 100)}% of leads` : "worth calling first"} />
        <Kpi label="Calls today" value={fmt(k?.callsToday)} sub={`${fmt(k?.dials)} all time`} trend={days.map((d) => d.calls)} />
        <Kpi
          label="Answer rate"
          value={k?.answerRate == null ? "–" : `${Math.round(k.answerRate * 100)}%`}
          sub="picked up / dialled"
          trend={days.map((d) => (d.calls ? d.answered / d.calls : 0))}
        />
        <Kpi label="Booked & won" value={fmt(k?.booked)} sub="audits booked + clients" />
        {emailOn ? (
          <Kpi label="Emails today" value={fmt(k?.emailsToday)} sub="no-answer follow-ups" trend={days.map((d) => d.emails)} />
        ) : (
          <Kpi label="To call" value={fmt(data?.stages.new)} sub={`${fmt(data?.stages.callback)} callbacks · ${fmt(data?.stages.recall)} to retry`} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-3 xl:col-span-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex flex-wrap gap-1 rounded-lg bg-background p-1" role="radiogroup" aria-label="Colour by">
              {METRICS.map((x) => (
                <button
                  key={x.value}
                  role="radio"
                  aria-checked={metric === x.value}
                  onClick={() => setMetric(x.value)}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    metric === x.value ? "bg-surface font-medium text-accent shadow-sm" : "text-muted hover:text-foreground",
                  )}
                >
                  {x.short}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {LAYERS.map((l) => (
                <button
                  key={l.key}
                  title={l.hint}
                  onClick={() => setLayers({ ...layers, [l.key]: !layers[l.key] })}
                  className={cx(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    layers[l.key] ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {l.label}
                </button>
              ))}
              <button
                onClick={() => setFitKey((x) => x + 1)}
                className="ml-1 rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
                title="Zoom to all leads"
                aria-label="Zoom to all leads"
              >
                <LocateFixed size={15} />
              </button>
            </div>
          </div>
          <div className={cx("overflow-hidden rounded-xl", fullscreen ? "h-[calc(100vh-330px)]" : "h-[420px] md:h-[560px]")}>
            <HeatMap
              data={data}
              areas={cov?.areas ?? []}
              metric={metric}
              layers={layers}
              fitKey={fitKey}
              flyTo={fly}
              onZoom={setZoom}
              onRegions={setRegionStats}
              className="h-full w-full"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <HeatLegend bins={bins} metricLabel={m.label} />
            <span className="text-xs text-muted">{levelFor(zoom)}</span>
          </div>
        </Card>

        <div className="space-y-4 xl:col-span-4">
          <Card>
            <h2 className="mb-2 font-semibold">Top places · {m.short.toLowerCase()}</h2>
            <p className="mb-2 text-xs text-muted">Click a place to zoom the map to it.</p>
            {topPlaces.length === 0 ? (
              <p className="text-sm text-muted">No places yet. Run a search to light up the map.</p>
            ) : (
              <ul className="space-y-1">
                {topPlaces.map((p) => {
                  const v = Number(p[metric]);
                  const max = Math.max(1, Number(topPlaces[0][metric]));
                  return (
                    <li key={p.place}>
                      <button
                        onClick={() => setFly({ lat: p.lat, lng: p.lng, zoom: 12, key: Date.now() })}
                        className="group w-full rounded-lg px-2 py-1.5 text-left hover:bg-background"
                        title={`Zoom the map to ${p.place}`}
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate group-hover:text-accent">{p.place}</span>
                          <span className="shrink-0 tabular-nums">
                            <b>{fmt(v)}</b>
                            <span className="ml-1.5 text-xs text-muted">{metric === "leads" ? `${fmt(p.good)} A/B` : `of ${fmt(p.leads)}`}</span>
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-border/60">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(v > 0 ? 1.5 : 0, (v / max) * 100)}%` }} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Where leads are</h2>
            <StackedBar
              parts={STAGES.filter((s) => emailOn || (s.value !== "followup" && s.value !== "replied")).map((s) => ({
                label: s.label,
                value: data?.stages[s.value] ?? 0,
                color: STAGE_COLOR[s.value],
              }))}
            />
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Calls, last 14 days</h2>
            <LineChart
              labels={days.map((d) => label(d.date))}
              series={[
                { name: "Calls", values: days.map((d) => d.calls) },
                { name: "Answered", values: days.map((d) => d.answered) },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
