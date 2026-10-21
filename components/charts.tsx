"use client";

import { useState } from "react";
import { cx, fmt } from "./ui";

// Small SVG charts for the dashboard. One hue (the app accent) for magnitude, text in text colours,
// hover tooltips on every mark.

/** Tiny trend line under a KPI. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cx("h-7 w-full", className)} preserveAspectRatio="none" aria-hidden>
      <polyline points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill="var(--accent)" fillOpacity={0.12} stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Line chart with a crosshair tooltip. series[0] is drawn solid, series[1] (optional) dashed. */
export function LineChart({
  labels,
  series,
  height = 140,
}: {
  labels: string[];
  series: { name: string; values: number[] }[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 320;
  const h = height;
  const pad = { l: 26, r: 6, t: 8, b: 18 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const x = (i: number) => pad.l + (n > 1 ? (i * (w - pad.l - pad.r)) / (n - 1) : 0);
  const y = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  // Unique gridline values: with tiny maxima (0–2 calls) the halfway mark rounds onto 0 or the top.
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} role="img" aria-label={series.map((s) => s.name).join(" and ") + " per day"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" className="fill-[var(--muted)]" fontSize={9}>
              {t}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          (i % Math.ceil(n / 5) === 0 && n - 1 - i >= Math.ceil(n / 5) / 2) || i === n - 1 ? (
            <text key={l} x={x(i)} y={h - 4} textAnchor="middle" className="fill-[var(--muted)]" fontSize={9}>
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, si) => (
          <polyline
            key={s.name}
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity={si === 0 ? 1 : 0.55}
            strokeDasharray={si === 0 ? undefined : "4 3"}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 2" />
            {series.map((s, si) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={3.5} fill="var(--accent)" fillOpacity={si === 0 ? 1 : 0.55} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </>
        )}
        {labels.map((l, i) => (
          <rect
            key={l}
            x={x(i) - (w - pad.l - pad.r) / Math.max(1, n - 1) / 2}
            y={0}
            width={(w - pad.l - pad.r) / Math.max(1, n - 1)}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow"
          style={{ left: `${(x(hover) / w) * 100}%`, transform: `translateX(${hover > n / 2 ? "-105%" : "5%"})` }}
        >
          <div className="font-medium">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="tabular-nums text-muted">
              {s.name}: <span className="text-foreground">{fmt(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex gap-4 text-xs text-muted">
          {series.map((s, si) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="0" x2="16" y1="3" y2="3" stroke="var(--accent)" strokeWidth={2} strokeOpacity={si === 0 ? 1 : 0.55} strokeDasharray={si === 0 ? undefined : "4 3"} />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One horizontal bar split into parts, with a legend; parts get fixed colours by meaning. */
export function StackedBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const [hover, setHover] = useState<string | null>(null);
  if (!total) return <p className="text-sm text-muted">No leads with a phone number yet.</p>;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              title={`${p.label}: ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`}
              onMouseEnter={() => setHover(p.label)}
              onMouseLeave={() => setHover(null)}
              className={cx("h-full transition-opacity", hover && hover !== p.label && "opacity-40")}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color, minWidth: 3 }}
            />
          ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5" onMouseEnter={() => setHover(p.label)} onMouseLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="truncate text-muted">{p.label}</span>
            <span className="ml-auto tabular-nums">{fmt(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
