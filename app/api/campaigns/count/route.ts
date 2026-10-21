import { body, json } from "@/lib/api";
import { db } from "@/lib/db";
import { countMatchingLeads, leadQuery, type LeadFilter } from "@/lib/outreach/campaigns";

// How many leads a filter would enroll, plus their country mix (for compliance notes).
export async function POST(req: Request) {
  const f = await body<LeadFilter>(req);
  const { where, params } = await leadQuery(f);
  const countries = await db.all(
    `SELECT COALESCE(b.country_code, '?') AS cc, COUNT(*) AS n FROM businesses b WHERE ${where} GROUP BY cc ORDER BY n DESC LIMIT 10`,
    ...params,
  );
  return json({ count: await countMatchingLeads(f), countries });
}
