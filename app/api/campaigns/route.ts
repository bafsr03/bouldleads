import { connection } from "next/server";
import { db, now } from "@/lib/db";
import { bad, body, json } from "@/lib/api";
import type { LeadFilter, Step } from "@/lib/outreach/campaigns";
import { TEMPLATES } from "@/lib/outreach/templates";
import { followupCampaign } from "@/lib/calls";

export async function GET() {
  await connection();
  await followupCampaign(); // always listed, pinned first
  const rows = await db.all(
    `SELECT c.*,
      (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id) AS leads,
      (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.state IN ('queued','in_sequence')) AS active_leads,
      (SELECT COUNT(*) FROM messages m JOIN campaign_leads cl ON cl.id = m.campaign_lead_id WHERE cl.campaign_id = c.id) AS sent,
      (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.state = 'replied') AS replied,
      (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.state = 'bounced') AS bounced,
      (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.state = 'unsubscribed') AS unsubscribed
     FROM campaigns c ORDER BY c.kind = 'followup' DESC, c.id DESC`,
  );
  return json(rows);
}

export async function POST(req: Request) {
  const b = await body<{ name: string; steps?: Step[]; inboxIds?: number[]; filter?: LeadFilter }>(req);
  if (!b.name?.trim()) return bad("Name your campaign.");
  const steps: Step[] = b.steps ?? TEMPLATES[0].steps;
  const r = await db.run(
    "INSERT INTO campaigns (name, steps, inbox_ids, lead_filter, created_at) VALUES (?, ?, ?, ?, ?)",
    b.name.trim(),
    JSON.stringify(steps),
    JSON.stringify(b.inboxIds ?? []),
    JSON.stringify(b.filter ?? { limit: 1000 }),
    now(),
  );
  return json({ id: r.lastId });
}
