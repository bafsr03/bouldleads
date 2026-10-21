import { db } from "./db";
import { STAGE_SQL } from "./calls";
import { NOT_REACHED, STAGES } from "./call-outcomes";
import { zoned } from "./outreach/inboxes";

// Data for the live heat-map dashboard: totals per country and per place, every lead as a compact
// point, and 14-day activity. One request, polled by the Places page.

export const TIER_CODE: Record<string, number> = { A: 1, B: 2, C: 3, not_fit: 4 };
export const TIER_OF_CODE = ["", "A", "B", "C", "not_fit"];

export type Counts = { leads: number; good: number; called: number; booked: number };
export type CountryRow = Counts & { cc: string };
export type PlaceRow = Counts & { place: string; lat: number; lng: number; searches: number };
/** [lat, lng, tier code (0 = not audited), stage index in STAGES, lead id] */
export type Point = [number, number, number, number, number];
export type Day = { date: string; leads: number; calls: number; answered: number; emails: number };

const COUNTS = `COUNT(*) AS leads, COALESCE(SUM(b.tier IN ('A','B')), 0) AS good,
  COALESCE(SUM(b.call_outcome IS NOT NULL), 0) AS called,
  COALESCE(SUM(b.call_outcome IN ('audit_booked','won')), 0) AS booked`;

const NOT_REACHED_SQL = `(${NOT_REACHED.map((o) => `'${o}'`).join(", ")})`;

export async function heatmapData(timeZone: string, now = Date.now()) {
  const since = now - 15 * 86_400_000;
  const stageSql = STAGE_SQL.replaceAll("businesses.", "b.");
  const [countries, places, rawPoints, calls, emails, found, stages, totals] = await Promise.all([
    db.all<CountryRow>(`SELECT b.country_code AS cc, ${COUNTS} FROM businesses b WHERE b.country_code IS NOT NULL GROUP BY b.country_code`),
    db.all<PlaceRow>(
      `SELECT s.place AS place, AVG(b.lat) AS lat, AVG(b.lng) AS lng, COUNT(DISTINCT s.id) AS searches, ${COUNTS}
       FROM businesses b JOIN searches s ON s.id = b.search_id
       WHERE s.place IS NOT NULL AND b.lat IS NOT NULL GROUP BY s.place ORDER BY leads DESC`,
    ),
    db.all<{ lat: number; lng: number; tier: string | null; stage: string; id: number }>(
      `SELECT b.lat, b.lng, b.tier, ${stageSql} AS stage, b.id FROM businesses b
       WHERE b.lat IS NOT NULL AND b.lng IS NOT NULL ORDER BY b.priority IS NULL, b.priority DESC LIMIT 20000`,
    ),
    db.all<{ at: number; outcome: string }>("SELECT created_at AS at, outcome FROM calls WHERE created_at >= ?", since),
    db.all<{ at: number }>("SELECT sent_at AS at FROM messages WHERE sent_at >= ?", since),
    db.all<{ at: number }>("SELECT created_at AS at FROM businesses WHERE created_at >= ?", since),
    db.all<{ k: string; n: number }>(`SELECT ${stageSql} AS k, COUNT(*) AS n FROM businesses b WHERE b.phone IS NOT NULL AND b.phone != '' AND b.phone_bad = 0 GROUP BY k`),
    db.get<{ dials: number; answered: number }>(
      `SELECT COUNT(*) AS dials, COALESCE(SUM(outcome NOT IN ${NOT_REACHED_SQL}), 0) AS answered FROM calls`,
    ),
  ]);

  // 14 days in the team's time zone, oldest first.
  const days: Day[] = [];
  const index = new Map<string, Day>();
  for (let i = 13; i >= 0; i--) {
    const date = zoned(new Date(now - i * 86_400_000), timeZone).date;
    if (index.has(date)) continue;
    const d = { date, leads: 0, calls: 0, answered: 0, emails: 0 };
    days.push(d);
    index.set(date, d);
  }
  const bump = (at: number, f: (d: Day) => void) => {
    const d = index.get(zoned(new Date(at), timeZone).date);
    if (d) f(d);
  };
  for (const c of calls)
    bump(c.at, (d) => {
      d.calls++;
      if (!NOT_REACHED.includes(c.outcome)) d.answered++;
    });
  for (const e of emails) bump(e.at, (d) => d.emails++);
  for (const b of found) bump(b.at, (d) => d.leads++);

  const stageIndex = new Map<string, number>(STAGES.map((s, i) => [s.value, i]));
  const points: Point[] = rawPoints.map((p) => [
    Math.round(p.lat * 1e5) / 1e5,
    Math.round(p.lng * 1e5) / 1e5,
    p.tier ? (TIER_CODE[p.tier] ?? 0) : 0,
    stageIndex.get(p.stage) ?? 0,
    p.id,
  ]);

  const sum = (k: keyof Counts) => countries.reduce((a, c) => a + Number(c[k]), 0);
  const today = days[days.length - 1];
  return {
    updatedAt: now,
    countries,
    places,
    points,
    days,
    stages: Object.fromEntries(stages.map((s) => [s.k, s.n])),
    kpis: {
      leads: await db.count("SELECT COUNT(*) FROM businesses"),
      good: sum("good"),
      callsToday: today.calls,
      answerRate: totals?.dials ? totals.answered / totals.dials : null,
      dials: totals?.dials ?? 0,
      booked: sum("booked"),
      emailsToday: today.emails,
    },
  };
}

export type HeatmapData = Awaited<ReturnType<typeof heatmapData>>;
