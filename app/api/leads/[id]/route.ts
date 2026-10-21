import { connection } from "next/server";
import { db } from "@/lib/db";
import { bad, body, json } from "@/lib/api";
import { auditOne, rescore } from "@/lib/audit/run-audit";
import { VISIBILITY_CHECKS, type ManualAnswers } from "@/lib/audit/score";
import { STAGE_SQL, cannotFollowUp, followupFor, isOutcome, logCall, startFollowup, stopEmails } from "@/lib/calls";
import { deleteLeads } from "@/lib/leads";
import { currentUser } from "@/lib/auth";

// The Deep audit action waits for Google and PageSpeed (up to about a minute).
export const maxDuration = 120;
import tzlookup from "tz-lookup";

export async function GET(_req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  await connection();
  const id = Number((await ctx.params).id);
  const b = await db.get<Record<string, unknown> & { audit: string | null; audit_manual: string | null; name: string; email: string | null; status: string; dnc: number }>(
    `SELECT *, ${STAGE_SQL} AS stage FROM businesses WHERE id = ?`,
    id,
  );
  if (!b) return bad("Not found", 404);
  const [outreach, replies, calls, emails, search, followup, followupBlocked] = await Promise.all([
    db.all(
      `SELECT cl.state, cl.step, cl.next_send_at, cl.updated_at, c.id AS campaign_id, c.name AS campaign, c.kind
       FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id WHERE cl.business_id = ? ORDER BY cl.updated_at DESC`,
      id,
    ),
    db.all(
      `SELECT r.kind, r.subject, r.snippet, r.received_at FROM replies r JOIN campaign_leads cl ON cl.id = r.campaign_lead_id
       WHERE cl.business_id = ? ORDER BY r.received_at DESC LIMIT 20`,
      id,
    ),
    db.all("SELECT id, outcome, note, user, created_at FROM calls WHERE business_id = ? ORDER BY created_at DESC LIMIT 50", id),
    db.all(
      `SELECT m.step, m.subject, m.sent_at, c.name AS campaign FROM messages m JOIN campaign_leads cl ON cl.id = m.campaign_lead_id
       JOIN campaigns c ON c.id = cl.campaign_id WHERE cl.business_id = ? ORDER BY m.sent_at DESC LIMIT 20`,
      id,
    ),
    db.get("SELECT id, label, place FROM searches WHERE id = ?", (b.search_id as number | null) ?? -1),
    followupFor(id),
    cannotFollowUp(b as never),
  ]);
  let tz: string | null = null;
  try {
    tz = b.lat != null && b.lng != null ? tzlookup(Number(b.lat), Number(b.lng)) : null;
  } catch {}
  return json({
    ...b,
    tz,
    audit: b.audit ? JSON.parse(b.audit) : null,
    audit_manual: b.audit_manual ? JSON.parse(b.audit_manual) : {},
    outreach,
    replies,
    calls,
    emails,
    search: search ?? null,
    followup,
    followupBlocked,
  });
}

type Patch = {
  check?: { id: string; state: "pass" | "fail" | null };
  notes?: string;
  callOutcome?: string | null;
  callNote?: string;
  callbackAt?: number | null;
  startFollowup?: boolean; // override the "No answer starts emails" setting for this call
  category?: string; // what the business really is, set by hand (e.g. after checking the Google profile)
  askFor?: string | null; // who to ask for: "Jamie answers, ask for Kenny"
};

// Manual audit answers, notes and call outcomes. Re-scores instantly from the stored research.
export async function PATCH(req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const id = Number((await ctx.params).id);
  const b = await body<Patch>(req);
  const row = await db.get<{ audit_manual: string | null }>("SELECT audit_manual FROM businesses WHERE id = ?", id);
  if (!row) return bad("Not found", 404);

  if (b.check || typeof b.notes === "string") {
    const manual: ManualAnswers = row.audit_manual ? JSON.parse(row.audit_manual) : {};
    if (b.check) {
      if (!VISIBILITY_CHECKS.some((c) => c.id === b.check!.id)) return bad("Unknown check");
      manual.checks ??= {};
      if (b.check.state === "pass" || b.check.state === "fail") manual.checks[b.check.id] = b.check.state;
      else delete manual.checks[b.check.id];
    }
    if (typeof b.notes === "string") manual.notes = b.notes.slice(0, 10_000);
    await db.run("UPDATE businesses SET audit_manual = ? WHERE id = ?", JSON.stringify(manual), id);
  }

  if (typeof b.category === "string") {
    const category = b.category.trim().slice(0, 80);
    if (!category) return bad("Category can't be empty");
    // Set by a person (2): never overridden; re-audit so the ranking search and talking points use it.
    await db.run("UPDATE businesses SET category = ?, category_confirmed = 2, audit_status = 'queued' WHERE id = ?", category, id);
  }

  if (b.askFor !== undefined) await db.run("UPDATE businesses SET ask_for = ? WHERE id = ?", b.askFor?.trim().slice(0, 120) || null, id);

  let call = null;
  if (b.callOutcome !== undefined) {
    if (b.callOutcome !== null && !isOutcome(b.callOutcome)) return bad("Unknown outcome");
    call = await logCall(id, b.callOutcome, {
      note: b.callNote?.slice(0, 2000) || null,
      callbackAt: b.callbackAt ?? null,
      user: await currentUser(),
      startFollowup: b.startFollowup,
    });
  } else if (b.callbackAt !== undefined) {
    await db.run("UPDATE businesses SET callback_at = ? WHERE id = ?", b.callbackAt, id);
  }
  const audit = b.check ? await rescore(id) : undefined;
  return json({ ok: true, audit, call });
}

// { action: "audit" } queues a fresh research run. { action: "followup" | "stop_followup" } starts or stops the no-answer emails.
export async function POST(req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const id = Number((await ctx.params).id);
  const { action } = await body<{ action: string }>(req);
  if (action === "audit") {
    const r = await db.run("UPDATE businesses SET audit_status = 'queued' WHERE id = ?", id);
    if (!r.changes) return bad("Not found", 404);
    return json({ ok: true });
  }
  if (action === "deep") {
    // Full research now, including the deep Google profile and PageSpeed: about 10–60 seconds.
    const audit = await auditOne(id, { forceDeep: true });
    return audit ? json({ ok: true, audit }) : bad("The audit failed (see Overview → Activity).");
  }
  if (action === "followup") {
    const err = await startFollowup(id);
    return err ? bad(err) : json({ ok: true });
  }
  if (action === "stop_followup") {
    await stopEmails(id);
    return json({ ok: true });
  }
  return bad("Unknown action");
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const id = Number((await ctx.params).id);
  const remember = new URL(req.url).searchParams.get("remember") !== "0";
  const n = await deleteLeads([id], remember);
  return n ? json({ ok: true }) : bad("Not found", 404);
}
