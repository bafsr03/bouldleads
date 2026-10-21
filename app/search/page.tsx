"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Badge, Button, Card, Input, Label, Notice, PageHeader, Progress, Select, StatusBadge, ago, cx, fmt } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { toast } from "@/components/feedback";
import { TypePicker } from "@/components/type-picker";
import { ruleFor } from "@/lib/compliance/rules";
import type { MapArea } from "@/components/area-map";
import { CoverageLegend, type CoverageArea } from "@/components/coverage-style";

const AreaMap = dynamic(() => import("@/components/area-map"), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-xl bg-border/50" />,
});

type Place = {
  label: string;
  type: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  bbox: [number, number, number, number];
  areaId: number | null;
};

type SearchRow = {
  id: number;
  label: string;
  source: string;
  status: string;
  tiles_total: number;
  tiles_done: number;
  found: number;
  verified: number;
  pending: number;
  error: string | null;
  created_at: number;
  country_code: string | null;
};

type Box = [number, number, number, number]; // south, west, north, east

function boxOf(a: MapArea | CoverageArea["area"]): Box {
  if (a.type === "place") return a.bbox;
  const d = a.radiusKm / 111.32;
  const dl = d / Math.max(0.01, Math.cos((a.lat * Math.PI) / 180));
  return [a.lat - d, a.lng - dl, a.lat + d, a.lng + dl];
}

/** An earlier search with the same business types covering most of this area. */
function findOverlap(area: MapArea, cats: string[], areas: (CoverageArea & { categories?: string[] })[]) {
  const [s, w, n, e] = boxOf(area);
  const size = (n - s) * (e - w);
  if (size <= 0) return null;
  return (
    areas
      .filter((a) => a.status === "done" && (a.categories ?? []).some((c) => cats.includes(c)))
      .map((a) => {
        const [s2, w2, n2, e2] = boxOf(a.area);
        const inter = Math.max(0, Math.min(n, n2) - Math.max(s, s2)) * Math.max(0, Math.min(e, e2) - Math.max(w, w2));
        return { a, share: inter / size };
      })
      .filter((x) => x.share >= 0.5)
      .sort((x, y) => y.a.created_at - x.a.created_at)[0]?.a ?? null
  );
}

const CATS_KEY = "bouldleads:search-types";
const noSubscribe = () => () => {};
const readSavedCats = () => {
  try {
    return localStorage.getItem(CATS_KEY) ?? "[]";
  } catch {
    return "[]";
  }
};
function parseCats(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : [];
  } catch {
    return [];
  }
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  // Nothing pre-selected: the last pick is remembered on this device.
  const savedCats = useSyncExternalStore(noSubscribe, readSavedCats, () => "[]");
  const [picked, setPicked] = useState<string[] | null>(null);
  const cats = picked ?? parseCats(savedCats);
  const setCats = (v: string[]) => {
    setPicked(v);
    try {
      localStorage.setItem(CATS_KEY, JSON.stringify(v));
    } catch {}
  };
  // Phone is enough: businesses without a website are often the best web-design prospects.
  const [contactMode, setContactMode] = useState<0 | 1 | 2>(2);
  const [maxResults, setMaxResults] = useState(5000);
  const [sourceChoice, setSource] = useState<"osm" | "google" | "both" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const { data: searches, reload } = useApi<SearchRow[]>("/api/searches", 4000);
  const { data: settings } = useApi<{ secrets: { googlePlacesApiKey: boolean } }>("/api/settings");
  const { data: coverage } = useApi<{ areas: CoverageArea[] }>("/api/coverage?bbox=0,0,0,0", 15_000);
  const hasGoogle = !!settings?.secrets.googlePlacesApiKey;
  // Default to both sources once a Google key exists; the user's pick wins.
  const source = sourceChoice ?? (hasGoogle ? "both" : "osm");

  const area: MapArea | null = place
    ? { type: "place", bbox: place.bbox }
    : center
      ? { type: "circle", lat: center.lat, lng: center.lng, radiusKm }
      : null;
  const rule = place?.countryCode ? ruleFor(place.countryCode) : null;
  const isBig = place && (place.bbox[2] - place.bbox[0]) * (place.bbox[3] - place.bbox[1]) > 4;
  const overlap = area ? findOverlap(area, cats, coverage?.areas ?? []) : null;

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`).then((r) => r.json());
      setPlaces(Array.isArray(r) ? r : []);
      if (!Array.isArray(r) || r.length === 0) setMsg({ tone: "red", text: "No places found." });
      else setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!area) return setMsg({ tone: "red", text: "Search for a place or click the map to set a centre point." });
    setBusy(true);
    setMsg(null);
    try {
      await send("/api/searches", "POST", {
        area: place
          ? { type: "place", label: place.label, bbox: place.bbox, areaId: place.areaId }
          : { type: "circle", lat: center!.lat, lng: center!.lng, radiusKm },
        categories: cats,
        source,
        countryCode: place?.countryCode ?? null,
        contactMode,
        maxResults,
      });
      toast("Search started. Businesses appear below, and their emails are found automatically.");
      reload();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Find leads"
        description="Search a city, region or whole country, or click the map to search a radius. Businesses come from OpenStreetMap (free) and, with a key, Google Places. BouldLeads then finds each public email and audits every lead."
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <form onSubmit={lookup}>
              <Label>Area</Label>
              <div className="flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Austin, Texas · Portugal · Manchester" />
                <Button type="submit" disabled={busy}>
                  Search
                </Button>
              </div>
            </form>
            {places.length > 0 && (
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border text-sm">
                {places.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        setPlace(p);
                        setCenter(null);
                        setPlaces([]);
                        setQuery(p.label.split(",").slice(0, 2).join(","));
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-background"
                    >
                      {p.label} <span className="text-xs text-muted">({p.type})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {place && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2 text-sm">
                <span className="truncate">
                  <b>{place.label.split(",")[0]}</b> <span className="text-muted">· whole {place.type}</span>
                </span>
                <button className="text-xs text-accent underline" onClick={() => setPlace(null)}>
                  clear
                </button>
              </div>
            )}
            {!place && (
              <div className="mt-4">
                <Label hint={center ? `${center.lat}, ${center.lng}` : "click the map to set the centre"}>Radius: {radiusKm} km</Label>
                <input type="range" min={1} max={100} value={radiusKm} onChange={(e) => setRadiusKm(+e.target.value)} className="w-full accent-[var(--accent)]" />
              </div>
            )}
          </Card>

          <Card>
            <Label hint="pick from the catalog, or type any keyword">Business types</Label>
            <TypePicker value={cats} onChange={setCats} />
          </Card>

          <Card className="space-y-3">
            <div>
              <Label>Source</Label>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border p-1 text-sm">
                {(
                  [
                    ["osm", "OpenStreetMap", "free"],
                    ["google", "Google", "best coverage"],
                    ["both", "Both", "merged"],
                  ] as const
                ).map(([v, label, sub]) => (
                  <button
                    key={v}
                    type="button"
                    disabled={v !== "osm" && !hasGoogle}
                    onClick={() => setSource(v)}
                    className={cx(
                      "rounded-md px-2 py-1.5 text-center disabled:cursor-not-allowed disabled:opacity-40",
                      source === v ? "bg-accent-soft font-medium text-accent" : "hover:bg-background",
                    )}
                  >
                    {label}
                    <span className="block text-[11px] font-normal text-muted">{sub}</span>
                  </button>
                ))}
              </div>
              {!hasGoogle ? (
                <p className="mt-1.5 text-xs text-muted">
                  OpenStreetMap is thin in many cities (Lima has 5 smoke shops listed, none with a website).{" "}
                  <Link href="/settings" className="text-accent hover:underline">
                    Add a Google Places key
                  </Link>{" "}
                  to search Google Maps too. About 20,000 businesses a month fit in Google&apos;s free allowance.
                </p>
              ) : (
                source !== "osm" && <p className="mt-1.5 text-xs text-muted">Each Google request returns up to 20 businesses and uses 1 of your 1,000 free monthly requests.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Must have</Label>
                <Select value={contactMode} onChange={(e) => setContactMode(+e.target.value as 0 | 1 | 2)}>
                  <option value={2}>Any contact: phone counts (recommended)</option>
                  <option value={1}>Website or email only</option>
                  <option value={0}>Nothing: every business</option>
                </Select>
              </div>
              <div>
                <Label>Max businesses</Label>
                <Input type="number" min={10} max={100000} value={maxResults} onChange={(e) => setMaxResults(+e.target.value)} />
              </div>
            </div>
            {rule && (
              <Notice tone={rule.level === "consent" ? "red" : rule.level === "ok" ? "green" : "amber"}>
                <b>{rule.law}:</b> {rule.summary}
              </Notice>
            )}
            {isBig && source !== "google" && (
              <Notice tone="blue">
                Large area: the search is split into tiles and can take a while (roughly 3–5 s per tile). You can keep using the app while it runs.
              </Notice>
            )}
            {overlap && (
              <Notice tone="blue">
                You already searched here: <b>#{overlap.id}</b> {overlap.label.split(" · ")[0]} on {new Date(overlap.created_at).toLocaleDateString()} found{" "}
                {fmt(overlap.leads)} leads. Searching again only adds businesses we don&apos;t have yet.
              </Notice>
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <Button variant="primary" className="w-full" onClick={start} disabled={busy || cats.length === 0 || !area}>
              Find businesses
            </Button>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="p-2">
            <AreaMap
              area={area}
              coverage={coverage?.areas}
              onPick={(lat, lng) => {
                setPlace(null);
                setCenter({ lat, lng });
              }}
            />
            <div className="px-2 pb-1 pt-2">
              <CoverageLegend points={false} />
            </div>
          </Card>
        </div>
      </div>

      <div className="mb-3 mt-10 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Recent searches</h2>
        <Link href="/places" className="text-sm text-accent hover:underline">
          All searches by place →
        </Link>
      </div>
      <div className="space-y-2">
        {(searches ?? []).length === 0 && <p className="text-sm text-muted">No searches yet.</p>}
        {(searches ?? []).slice(0, 8).map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.label}</span>
                  <StatusBadge status={s.status} />
                  {s.country_code && <Badge>{s.country_code}</Badge>}
                  {s.source === "google" && <Badge tone="blue">Google</Badge>}
                  {s.source === "both" && <Badge tone="blue">Google + OSM</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {ago(s.created_at)} · {fmt(s.found)} businesses · <span className="text-foreground">{fmt(s.verified)} verified emails</span>
                  {s.pending > 0 && ` · ${fmt(s.pending)} being checked`}
                </div>
                {s.error && <div className={cx("mt-1 text-xs", s.status === "failed" ? "text-red-600" : "text-amber-600")}>{s.error}</div>}
              </div>
              <div className="flex gap-2">
                <Link href={`/leads?searchId=${s.id}`}>
                  <Button size="sm">View leads</Button>
                </Link>
                {(s.status === "failed" || s.status === "cancelled" || (s.status === "done" && s.error)) && (
                  <Button size="sm" onClick={() => send(`/api/searches/${s.id}`, "POST", { action: "retry" }).then(() => (toast("Search restarted."), reload()))}>
                    Retry
                  </Button>
                )}
                {(s.status === "running" || s.status === "queued") && (
                  <Button size="sm" variant="danger" onClick={() => send(`/api/searches/${s.id}`, "POST", { action: "cancel" }).then(reload)}>
                    Stop
                  </Button>
                )}
              </div>
            </div>
            {s.status === "running" && s.tiles_total > 0 && (
              <div className={cx("mt-3")}>
                <Progress value={(s.tiles_done / s.tiles_total) * 100} />
                <div className="mt-1 text-xs text-muted">
                  {s.tiles_done}/{s.tiles_total} map tiles
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
