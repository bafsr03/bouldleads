import { connection } from "next/server";
import tzlookup from "tz-lookup";
import { db } from "@/lib/db";
import { json } from "@/lib/api";
import { memo } from "@/lib/memo";
import { CONVERSATION, NOT_REACHED } from "@/lib/call-outcomes";

// Call-first reporting: dials, answer rate, bookings and wins by tier, business type and pitch type; answer rate
// by hour of day (in the business's local time); follow-up replies by email step.

const NOT_REACHED_SQL = `(${NOT_REACHED.map((o) => `'${o}'`).join(", ")})`;
const CONVERSATION_SQL = `(${CONVERSATION.map((o) => `'${o}'`).join(", ")})`;
const WEEKS = 8;

// Bad-lead rate over the last 4 weeks, by the search the lead came from or its city (Oct 28 2026 brief §7).
const badSql = (key: string) => `
  SELECT ${key} AS k, COUNT(DISTINCT c.business_id) AS leads,
    COUNT(DISTINCT CASE WHEN c.outcome = 'bad_lead' THEN c.business_id END) AS bad
  FROM calls c JOIN businesses b ON b.id = c.business_id LEFT JOIN searches s ON s.id = b.search_id
  WHERE c.created_at >= ? GROUP BY k ORDER BY leads DESC LIMIT 10`;

const groupSql = (key: string) => `
  SELECT ${key} AS k, COUNT(*) AS dials, SUM(c.outcome NOT IN ${NOT_REACHED_SQL}) AS answered,
    COUNT(DISTINCT c.business_id) AS leads,
    COUNT(DISTINCT CASE WHEN b.call_outcome IN ('audit_booked', 'won') THEN b.id END) AS booked,
    COUNT(DISTINCT CASE WHEN b.call_outcome = 'won' THEN b.id END) AS won
  FROM calls c JOIN businesses b ON b.id = c.business_id GROUP BY k ORDER BY dials DESC LIMIT 10`;

export async function GET() {
  await connection();
  return json(await memo("report", 60_000, report));
}

async function report() {
  const since = Date.now() - 28 * 86_400_000;
  const [weekly, badBySearch, badByCity, badReasons] = await Promise.all([
    // Week = Monday to Sunday (UTC). Conversations = talked to the owner; screen shares = booked.
    db.all<{ week: string; calls: number; conversations: number; screenShares: number; closes: number; badLeads: number }>(
      `SELECT date(created_at / 1000, 'unixepoch', 'weekday 0', '-6 days') AS week, COUNT(*) AS calls,
         SUM(outcome IN ${CONVERSATION_SQL}) AS conversations, SUM(outcome = 'audit_booked') AS screenShares,
         SUM(outcome = 'won') AS closes, SUM(outcome = 'bad_lead') AS badLeads
       FROM calls WHERE created_at >= ? GROUP BY week ORDER BY week DESC`,
      Date.now() - WEEKS * 7 * 86_400_000,
    ),
    db.all<{ k: string; leads: number; bad: number }>(badSql("COALESCE(s.label, '(added by hand or from the site)')"), since),
    db.all<{ k: string; leads: number; bad: number }>(badSql("COALESCE(b.city, '(no city)')"), since),
    db.all<{ k: string; n: number }>("SELECT bad_reason AS k, COUNT(*) AS n FROM calls WHERE outcome = 'bad_lead' AND created_at >= ? GROUP BY k ORDER BY n DESC", since),
  ]);
  const [byTier, byType, byPitch, recent, sentByStep, repliedByStep, totals] = await Promise.all([
    db.all(groupSql("COALESCE(b.tier, 'unscored')")),
    db.all(groupSql("COALESCE(b.category, 'Other')")),
    // The pitch the lead had when it was called (stored on each call from Oct 2026).
    db.all(groupSql("COALESCE(c.pitch, 'unknown')")),
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
  return { totals, byTier, byType, byPitch, byHour: hours.filter((h) => h.dials > 0), followupSteps: steps, weekly, badBySearch, badByCity, badReasons };
}
