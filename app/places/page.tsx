"use client";

import { ChevronDown, ChevronRight, MapPin, RotateCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, StatusBadge, cx, fmt } from "@/components/ui";
import { confirmWithOption, toast } from "@/components/feedback";
import { send, useApi } from "@/components/use-api";
import { LiveDashboard } from "@/components/live-dashboard";

type Totals = { leads: number; tier_a: number; tier_b: number; with_email: number; with_phone: number; called: number; in_followup: number; booked: number };
type Search = Totals & {
  id: number;
  label: string;
  source: string;
  status: string;
  error: string | null;
  created_at: number;
  tiles_done: number;
  tiles_total: number;
};
type Place = { place: string; searches: Search[]; totals: Totals; last: number };

const SOURCE = { osm: "OpenStreetMap", google: "Google", both: "Google + OSM" } as Record<string, string>;

function Metric({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className="min-w-16">
      <div className={cx("text-lg font-semibold tabular-nums", tone)}>{fmt(n)}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

export default function PlacesPage() {
  const { data: places, reload } = useApi<Place[]>("/api/places", 30_000);
  const [refreshKey, setRefreshKey] = useState(0);
  const reloadMap = () => setRefreshKey((k) => k + 1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const all = places ?? [];

  async function rerun(s: Search) {
    try {
      await send(`/api/searches/${s.id}`, "POST", { action: "retry" });
      toast(`Search #${s.id} queued again. New businesses are added; existing ones aren't duplicated.`, "info");
      reload();
      reloadMap();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function remove(s: Search) {
    const r = await confirmWithOption({
      title: `Delete search #${s.id}?`,
      body: `“${s.label}”. The search is removed from history.`,
      confirmLabel: "Delete search",
      danger: true,
      checkbox: s.leads ? { label: `Also delete the ${fmt(s.leads)} leads it found (and don't add them back later)`, checked: false } : undefined,
    });
    if (!r.ok) return;
    const res = await send<{ deleted: number }>(`/api/searches/${s.id}${r.checked ? "?withLeads=1" : ""}`, "DELETE");
    toast(r.checked ? `Search and ${fmt(res.deleted)} leads deleted.` : "Search deleted. Its leads are kept.");
    reload();
    reloadMap();
  }

  return (
    <>
      <LiveDashboard refreshKey={refreshKey} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">Searches by place</h2>
      {places && all.length === 0 && (
        <Card className="py-12 text-center text-sm text-muted">
          <MapPin className="mx-auto mb-2" size={22} />
          No searches yet. <Link href="/search" className="text-accent hover:underline">Find businesses</Link> in a city or area to start.
        </Card>
      )}

      <div className="space-y-3">
        {all.map((p) => {
          const expanded = open[p.place] ?? all.length <= 3;
          return (
            <Card key={p.place} className="p-0">
              <div className="flex flex-wrap items-center gap-4 p-4">
                <button onClick={() => setOpen({ ...open, [p.place]: !expanded })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {expanded ? <ChevronDown size={16} className="shrink-0 text-muted" /> : <ChevronRight size={16} className="shrink-0 text-muted" />}
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.place}</div>
                    <div className="text-xs text-muted">
                      {p.searches.length} search{p.searches.length === 1 ? "" : "es"} · last {new Date(p.last).toLocaleDateString()}
                    </div>
                  </div>
                </button>
                <div className="flex flex-wrap gap-4">
                  <Metric n={p.totals.leads} label="leads" />
                  <Metric n={p.totals.tier_a + p.totals.tier_b} label="tier A + B" tone="text-accent" />
                  <Metric n={p.totals.with_phone} label="with phone" />
                  <Metric n={p.totals.with_email} label="with email" />
                  <Metric n={p.totals.called} label="called" />
                  <Metric n={p.totals.in_followup} label="emailing" />
                  <Metric n={p.totals.booked} label="booked" tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex gap-1.5">
                  <Link href={`/calls?place=${encodeURIComponent(p.place)}`}>
                    <Button size="sm">Call list</Button>
                  </Link>
                  <Link href={`/leads?place=${encodeURIComponent(p.place)}`}>
                    <Button size="sm">Leads</Button>
                  </Link>
                </div>
              </div>
              {expanded && (
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-2">Search</th>
                        <th className="px-4 py-2">Source</th>
                        <th className="px-4 py-2 text-right">Leads</th>
                        <th className="px-4 py-2 text-right">A + B</th>
                        <th className="px-4 py-2 text-right">Called</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {p.searches.map((s) => {
                        const running = s.status === "queued" || s.status === "running";
                        return (
                          <tr key={s.id} className="border-t border-border/60">
                            <td className="max-w-md px-4 py-2.5">
                              <Link href={`/leads?searchId=${s.id}`} className="hover:text-accent hover:underline">
                                <span className="text-muted">#{s.id}</span> {s.label.split(" · ")[0]}
                              </Link>
                              <div className="text-xs text-muted">{new Date(s.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>
                              {s.error && <div className="mt-0.5 line-clamp-2 text-xs text-amber-700 dark:text-amber-400">{s.error}</div>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{SOURCE[s.source] ?? s.source}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmt(s.leads)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmt(s.tier_a + s.tier_b)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmt(s.called)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <StatusBadge status={s.status} />
                              {running && s.tiles_total > 0 && (
                                <span className="ml-1.5 text-xs text-muted">
                                  {s.tiles_done}/{s.tiles_total}
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right">
                              <Button size="sm" variant="ghost" title="Run this search again" disabled={running} onClick={() => rerun(s)}>
                                <RotateCw size={13} />
                              </Button>
                              <Button size="sm" variant="ghost" title="Delete search" onClick={() => remove(s)} className="text-red-700 dark:text-red-400">
                                <Trash2 size={13} />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
