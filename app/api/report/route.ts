import { connection } from "next/server";
import tzlookup from "tz-lookup";
import { db } from "@/lib/db";
import { json } from "@/lib/api";
import { NOT_REACHED } from "@/lib/call-outcomes";

// Call-first reporting: dials, answer rate, bookings and wins by tier and business type; answer rate
// by hour of day (in the business's local time); follow-up replies by email step.

const NOT_REACHED_SQL = `(${NOT_REACHED.map((o) => `'${o}'`).join(", ")})`;

const groupSql = (key: string) => `
  SELECT ${key} AS k, COUNT(*) AS dials, SUM(c.outcome NOT IN ${NOT_REACHED_SQL}) AS answered,
    COUNT(DISTINCT c.business_id) AS leads,
    COUNT(DISTINCT CASE WHEN b.call_outcome IN ('audit_booked', 'won') THEN b.id END) AS booked,
    COUNT(DISTINCT CASE WHEN b.call_outcome = 'won' THEN b.id END) AS won
  FROM calls c JOIN businesses b ON b.id = c.business_id GROUP BY k ORDER BY dials DESC LIMIT 10`;

export async function GET() {
  await connection();
  const [byTier, byType, recent, sentByStep, repliedByStep, totals] = await Promise.all([
    db.all(groupSql("COALESCE(b.tier, 'unscored')")),
    db.all(groupSql("COALESCE(b.category, 'Other')")),
    db.all<{ created_at: number; outcome: string; lat: number | null; lng: number | null }>(
      "SELECT c.created_at, c.outcome, b.lat, b.lng FROM calls c JOIN businesses b ON b.id = c.business_id ORDER BY c.id DESC LIMIT 5000",
    ),
    db.all<{ step: number; n: number }>(
      `SELECT m.step, COUNT(*) AS n FROM messages m JOIN campaign_leads cl ON cl.id = m.campaign_lead_id
       JOIN campaigns c ON c.id = cl.campaign_id WHERE c.kind = 'followup' GROUP BY m.step`,
    ),
    // A reply after N emails counts for email N.
    db.all<{ step: number; n: number }>(
      `SELECT cl.step - 1 AS step, COUNT(*) AS n FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
       WHERE c.kind = 'followup' AND cl.state = 'replied' AND cl.step > 0 GROUP BY cl.step`,
    ),
    db.get<{ dials: number; answered: number; leads: number }>(
      `SELECT COUNT(*) AS dials, COALESCE(SUM(outcome NOT IN ${NOT_REACHED_SQL}), 0) AS answered, COUNT(DISTINCT business_id) AS leads FROM calls`,
    ),
  ]);

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, dials: 0, answered: 0 }));
  for (const c of recent) {
    let tz = "UTC";
    try {
      if (c.lat != null && c.lng != null) tz = tzlookup(c.lat, c.lng);
    } catch {}
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(c.created_at)));
    hours[h].dials++;
    if (!NOT_REACHED.includes(c.outcome)) hours[h].answered++;
  }

  const steps = sentByStep.map((s) => ({ step: s.step, sent: s.n, replied: repliedByStep.find((r) => r.step === s.step)?.n ?? 0 }));
  return json({ totals, byTier, byType, byHour: hours.filter((h) => h.dials > 0), followupSteps: steps });
}
