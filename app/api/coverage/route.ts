import { connection } from "next/server";
import { db } from "@/lib/db";
import { STAGE_SQL } from "@/lib/calls";
import { json } from "@/lib/api";
import { memo } from "@/lib/memo";

// Map data: every searched area with its yield, plus lead dots (for the visible map area if given).
export async function GET(req: Request) {
  await connection();
  const p = new URL(req.url).searchParams;
  const bbox = p.get("bbox")?.split(",").map(Number); // south,west,north,east
  return json(await memo(`coverage:${bbox?.join(",") ?? ""}`, 20_000, () => coverage(bbox)));
}

async function coverage(bbox: number[] | undefined) {
  const areas = (
    await db.all<{ area: string; categories: string } & Record<string, unknown>>(
      `SELECT s.id, s.label, s.place, s.status, s.area, s.categories, s.created_at,
         COUNT(b.id) AS leads, SUM(b.tier IN ('A','B')) AS good, SUM(b.call_outcome IS NOT NULL) AS called,
         SUM(b.call_outcome IN ('audit_booked','won')) AS booked
       FROM searches s LEFT JOIN businesses b ON b.search_id = s.id GROUP BY s.id ORDER BY s.id`,
    )
  ).map((r) => ({ ...r, area: JSON.parse(r.area), categories: JSON.parse(r.categories) }));

  const where = ["lat IS NOT NULL", "lng IS NOT NULL"];
  const args: number[] = [];
  if (bbox?.length === 4 && bbox.every(Number.isFinite)) {
    where.push("lat BETWEEN ? AND ?", "lng BETWEEN ? AND ?");
    args.push(bbox[0], bbox[2], bbox[1], bbox[3]);
  }
  const points = await db.all(
    `SELECT id, name, lat, lng, tier, ${STAGE_SQL} AS stage FROM businesses WHERE ${where.join(" AND ")}
     ORDER BY priority IS NULL, priority DESC LIMIT 5000`,
    ...args,
  );
  return { areas, points };
}
