import { connection } from "next/server";
import { db } from "@/lib/db";
import { STAGE_SQL } from "@/lib/calls";
import { json } from "@/lib/api";
import { memo } from "@/lib/memo";

// Searches grouped by place, with lead and outreach counts for each search.
export async function GET() {
  await connection();
  return json(await memo("places", 20_000, places));
}

async function places() {
  const rows = await db.all<Record<string, unknown> & { place: string | null }>(
    `SELECT s.id, s.label, s.place, s.source, s.status, s.categories, s.found, s.error, s.created_at, s.finished_at,
       s.tiles_done, s.tiles_total, s.area,
       COUNT(b.id) AS leads,
       SUM(b.tier = 'A') AS tier_a, SUM(b.tier = 'B') AS tier_b,
       SUM(b.email IS NOT NULL AND b.status = 'verified') AS with_email,
       SUM(b.phone IS NOT NULL AND b.phone != '') AS with_phone,
       SUM(b.call_outcome IS NOT NULL) AS called,
       SUM(${STAGE_SQL.replaceAll("businesses.", "b.")} = 'followup') AS in_followup,
       SUM(b.call_outcome IN ('audit_booked', 'won')) AS booked
     FROM searches s LEFT JOIN businesses b ON b.search_id = s.id
     GROUP BY s.id ORDER BY s.id DESC`,
  );
  const groups = new Map<string, { place: string; searches: typeof rows; totals: Record<string, number>; last: number }>();
  const SUMS = ["leads", "tier_a", "tier_b", "with_email", "with_phone", "called", "in_followup", "booked"];
  for (const r of rows) {
    const place = r.place || "Other areas";
    const g = groups.get(place) ?? { place, searches: [], totals: Object.fromEntries(SUMS.map((k) => [k, 0])), last: 0 };
    g.searches.push({ ...r, categories: JSON.parse(String(r.categories)), area: JSON.parse(String(r.area)) });
    for (const k of SUMS) g.totals[k] += Number(r[k] ?? 0);
    g.last = Math.max(g.last, Number(r.created_at));
    groups.set(place, g);
  }
  return [...groups.values()].sort((a, b) => b.last - a.last);
}
