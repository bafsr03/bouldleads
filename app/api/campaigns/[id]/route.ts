import { connection } from "next/server";
import { db, logEvent, now } from "@/lib/db";
import { bad, body, json } from "@/lib/api";
import {
  countMatchingLeads,
  enrollLeads,
  validateCampaign,
  type CampaignRow,
  type LeadFilter,
  type Step,
} from "@/lib/outreach/campaigns";

function load(id: number) {
  return db.get<CampaignRow>("SELECT * FROM campaigns WHERE id = ?", id);
}

export async function GET(_req: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  await connection();
  const id = Number((await ctx.params).id);
  const c = await load(id);
  if (!c) return bad("Not found", 404);
  const [states, recent, replies, sent] = await Promise.all([
    db.all("SELECT state, COUNT(*) AS n FROM campaign_leads WHERE campaign_id = ? GROUP BY state", id),
    db.all(
      `SELECT cl.id, cl.business_id, cl.email, cl.state, cl.step, cl.next_send_at, cl.last_error, b.name, b.city
       FROM campaign_leads cl JOIN businesses b ON b.id = cl.business_id
       WHERE cl.campaign_id = ? ORDER BY cl.updated_at DESC LIMIT 50`,
      id,
    ),
    db.all(
      `SELECT r.*, b.name FROM replies r JOIN campaign_leads cl ON cl.id = r.campaign_lead_id
       JOIN businesses b ON b.id = cl.business_id WHERE cl.campaign_id = ? ORDER BY r.received_at DESC LIMIT 50`,
      id,
    ),
    db.count("SELECT COUNT(*) FROM messages m JOIN campaign_leads cl ON cl.id = m.campaign_lead_id WHERE cl.campaign_id = ?", id),
  ]);
  return json({ ...c, steps: JSON.parse(c.steps), inbox_ids: JSON.parse(c.inbox_ids), lead_filter: JSON.parse(c.lead_filter), states, recent, replies, sent });
}

type Patch = { name?: string; steps?: Step[]; inboxIds?: number[]; filter?: LeadFilter; action?: "launch" | "pause" | "resume" };

export async function PATCH(req: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const id = Number((await ctx.params).id);
  const c = await load(id);
  if (!c) return bad("Not found", 404);
  const b = await body<Patch>(req);
  if (c.kind === "followup" && (b.filter || b.action === "launch")) return bad("The no-answer follow-up gets its leads from the call list.");

  if (b.name !== undefined || b.steps || b.inboxIds || b.filter) {
    // Steps & inboxes stay editable while running (fixes typos); the lead list is frozen once launched.
    if (b.filter && c.status !== "draft") return bad("The lead list can't be changed after launch.");
    await db.run(
      "UPDATE campaigns SET name = ?, steps = ?, inbox_ids = ?, lead_filter = ? WHERE id = ?",
      b.name?.trim() || c.name,
      b.steps ? JSON.stringify(b.steps) : c.steps,
      b.inboxIds ? JSON.stringify(b.inboxIds.map(Number)) : c.inbox_ids,
      b.filter ? JSON.stringify(b.filter) : c.lead_filter,
      id,
    );
  }

  const fresh = (await load(id))!;
  if (b.action === "launch") {
    if (fresh.status !== "draft") return bad("Campaign already launched.");
    const err = await validateCampaign(JSON.parse(fresh.steps), JSON.parse(fresh.inbox_ids));
    if (err) return bad(err);
    const filter = JSON.parse(fresh.lead_filter) as LeadFilter;
    if ((await countMatchingLeads(filter)) === 0) return bad("No verified, uncontacted leads match this filter.");
    const added = await enrollLeads(id, filter);
    await db.run("UPDATE campaigns SET status = 'active', launched_at = ? WHERE id = ?", now(), id);
    await logEvent("info", `Campaign "${fresh.name}" launched with ${added} leads`);
    return json({ ok: true, enrolled: added });
  }
  if (b.action === "pause" && fresh.status === "active") await db.run("UPDATE campaigns SET status = 'paused' WHERE id = ?", id);
  if (b.action === "resume" && fresh.status === "paused") await db.run("UPDATE campaigns SET status = 'active' WHERE id = ?", id);
  return json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const id = Number((await ctx.params).id);
  const c = await load(id);
  if (!c) return bad("Not found", 404);
  if (c.kind === "followup") return bad("The no-answer follow-up can be paused but not deleted.");
  if (c.status !== "draft") return bad("Only drafts can be deleted. Pause the campaign instead.");
  await db.batch([
    ["DELETE FROM campaign_leads WHERE campaign_id = ?", id],
    ["DELETE FROM campaigns WHERE id = ?", id],
  ]);
  return json({ ok: true });
}
