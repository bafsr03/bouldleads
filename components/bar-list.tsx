"use client";

import { fmt } from "./ui";

export type BarRow = { label: string; value: number; note?: string };

/**
 * Single-series horizontal bars (one hue). Values and notes use text colours,
 * the bar carries magnitude only; each row has a hover tooltip via title.
 */
export function BarList({ rows, emptyText = "No data yet." }: { rows: BarRow[]; emptyText?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value.toLocaleString()}${r.note ? ` (${r.note})` : ""}`} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              <b>{fmt(r.value)}</b>
              {r.note && <span className="ml-1.5 text-xs text-muted">{r.note}</span>}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-border/60">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 group-hover:opacity-80"
              style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
