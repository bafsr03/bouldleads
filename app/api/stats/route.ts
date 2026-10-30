import { connection } from "next/server";
import { db } from "@/lib/db";
import { getSettings, getSys } from "@/lib/settings";
import { localDate } from "@/lib/outreach/inboxes";
import { STAGE_SQL } from "@/lib/calls";
import { bad, json } from "@/lib/api";
import { memo } from "@/lib/memo";

const groupCount = async (col: string) =>
  Object.fromEntries((await db.all<{ k: string; n: number }>(`SELECT ${col} AS k, COUNT(*) AS n FROM businesses WHERE ${col} IS NOT NULL GROUP BY k`)).map((r) => [r.k, r.n]));

// Polled by the sidebar and the dashboard on every open tab: cached for 15 s (lib/memo.ts).
export async function GET() {
  await connection();
  try {
    return json(await memo("stats", 15_000, stats));
  } catch (e) {
    // Turso's monthly read allowance used up: every page would just look empty, so the sidebar says why.
    if ((e as { code?: string }).code === "BLOCKED") return bad("Database limit reached: Turso has paused reads for this month. Your data is safe.", 503);
    throw e;
  }
}

async function stats() {
  const s = await getSettings();
  const one = (sql: string, ...args: (string | number)[]) => db.count(sql, ...args);
  const [
    businesses, byStatus, sent, sentToday, replied, bounced, unsubscribed, queued, activeCampaigns, inboxes, contacted,
    withWebsite, emailFound, topTypes, tiers, outcomes, stages, auditing, patterns, lastTick, callbacksDue,
  ] = await Promise.all([
    one("SELECT COUNT(*) FROM businesses"),
    groupCount("status"),
    one("SELECT COUNT(*) FROM messages"),
    one("SELECT COALESCE(SUM(sent_today), 0) FROM inboxes WHERE sent_date = ?", localDate(s.timezone)),
    one("SELECT COUNT(*) FROM campaign_leads WHERE state = 'replied'"),
    one("SELECT COUNT(*) FROM campaign_leads WHERE state = 'bounced'"),
    one("SELECT COUNT(*) FROM campaign_leads WHERE state = 'unsubscribed'"),
    one("SELECT COUNT(*) FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id WHERE c.status = 'active' AND cl.state IN ('queued','in_sequence')"),
    one("SELECT COUNT(*) FROM campaigns WHERE status = 'active' AND kind != 'followup'"),
    one("SELECT COUNT(*) FROM inboxes WHERE active = 1"),
    one("SELECT COUNT(*) FROM campaign_leads WHERE step > 0 OR state IN ('replied','bounced','unsubscribed','completed')"),
    one("SELECT COUNT(*) FROM businesses WHERE website IS NOT NULL OR email IS NOT NULL"),
    one("SELECT COUNT(*) FROM businesses WHERE email IS NOT NULL"),
    db.all(
      `SELECT COALESCE(category, 'Other') AS type, COUNT(*) AS found, SUM(status = 'verified') AS verified
       FROM businesses GROUP BY type ORDER BY verified DESC, found DESC LIMIT 8`,
    ),
    groupCount("tier"),
    groupCount("call_outcome"),
    db.all<{ k: string; n: number }>(
      `SELECT ${STAGE_SQL} AS k, COUNT(*) AS n FROM businesses
       WHERE phone IS NOT NULL AND phone != '' AND phone_bad = 0 GROUP BY k`,
    ),
    one("SELECT COUNT(*) FROM businesses WHERE audit_status IN ('queued','running')"),
    db.all(
      `SELECT json_extract(audit, '$.pattern.label') AS label, COUNT(*) AS n FROM businesses
       WHERE audit IS NOT NULL AND tier != 'not_fit' GROUP BY label ORDER BY n DESC`,
    ),
    getSys("lastTick"),
    one("SELECT COUNT(*) FROM businesses WHERE callback_at IS NOT NULL AND callback_at <= ? AND dnc = 0 AND phone_bad = 0", Date.now()),
  ]);
  const last = Number(lastTick ?? 0);
  return {
    businesses, byStatus, sent, sentToday, replied, bounced, unsubscribed, queued, activeCampaigns, inboxes, contacted,
    withWebsite, emailFound, topTypes, tiers, outcomes, auditing, patterns, callbacksDue,
    stages: Object.fromEntries(stages.map((r) => [r.k, r.n])),
    lastTick: last || null,
    // Background tasks run every minute (hosted) or continuously (local worker).
    workerOnline: Date.now() - last < 3 * 60_000,
    setupDone: !!(s.companyName && s.postalAddress),
    emailOutreach: s.emailOutreach,
  };
}
