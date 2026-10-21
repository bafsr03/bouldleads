import { connection } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { filterFromUrl, leadListWhere, leadOrder, topIssue } from "@/lib/leads";
import { STAGE_SQL } from "@/lib/calls";

// CSV export of the current lead view. ?format=dialer gives the call list in the columns auto dialers
// and CRMs (WAVV, GoHighLevel…) import, limited to the daily dialer batch size.

const COLS = [
  "name", "category", "address", "city", "country_code", "phone", "website", "email", "email_confidence", "email_source", "status",
  "tier", "priority", "visibility_score", "conversion_score", "rating", "review_count", "google_maps_url",
  "stage", "call_outcome", "call_attempts", "top_issue",
];

const DIALER_COLS: [string, string][] = [
  ["Company Name", "name"],
  ["Phone", "phone"],
  ["Email", "email"],
  ["Website", "website"],
  ["Address", "address"],
  ["City", "city"],
  ["Country", "country_code"],
  ["Tags", "tags"],
  ["Notes", "notes"],
  ["Lead ID", "id"],
];

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const dialer = url.searchParams.get("format") === "dialer";
  const f = filterFromUrl(req.url);
  const { where, params } = leadListWhere(f);
  const limit = dialer ? (await getSettings()).dialerBatchSize : 100_000;
  const rows = (
    await db.all<Record<string, unknown>>(`SELECT *, ${STAGE_SQL} AS stage FROM businesses ${where} ${leadOrder(f)} LIMIT ?`, ...params, limit)
  ).map((r) => ({
    ...r,
    top_issue: topIssue(r.audit as string | null),
    tags: ["bouldleads", r.tier ? `tier-${r.tier}` : null, r.category].filter(Boolean).join(";"),
    notes: [topIssue(r.audit as string | null), r.rating != null ? `Google ${r.rating}★ (${r.review_count ?? 0})` : null].filter(Boolean).join(" · "),
  }));
  const head = dialer ? DIALER_COLS.map(([h]) => h) : COLS;
  const keys = dialer ? DIALER_COLS.map(([, k]) => k) : COLS;
  const csv = [head.join(","), ...rows.map((r) => keys.map((c) => cell((r as Record<string, unknown>)[c])).join(","))].join("\n");
  const name = dialer ? "dialer-list" : "bouldleads";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
