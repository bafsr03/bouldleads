import { connection } from "next/server";
import { db, marks } from "@/lib/db";
import { bad, body, int, json } from "@/lib/api";
import { auditSummary, deleteLeads, filterFromUrl, leadListWhere, leadOrder, resolveIds } from "@/lib/leads";
import { STAGE_SQL, startFollowup } from "@/lib/calls";
import tzlookup from "tz-lookup";

const PAGE = 100;

export async function GET(req: Request) {
  await connection();
  const page = Math.max(0, int(new URL(req.url).searchParams.get("page")));
  const f = filterFromUrl(req.url);
  const { where, params } = leadListWhere(f);
  const [total, rows] = await Promise.all([
    db.count(`SELECT COUNT(*) FROM businesses ${where}`, ...params),
    db.all<{ audit: string | null }>(
      `SELECT id, search_id, name, category, category_confirmed, address, city, country_code, lat, lng, phone, website, email, email_source, email_confidence, status,
         rating, review_count, google_maps_url, audit_status, visibility_score, conversion_score, priority, tier, audit,
         call_outcome, called_at, call_attempts, callback_at, warm_tries, ask_for, social_url, chain, dnc, phone_bad, ${STAGE_SQL} AS stage,
         (SELECT c.note FROM calls c WHERE c.business_id = businesses.id AND c.note IS NOT NULL AND c.note != '' ORDER BY c.created_at DESC LIMIT 1) AS last_note,
         (SELECT cl.step || '/' || json_array_length(c.steps) || '/' || cl.state || '/' || cl.next_send_at
            FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
            WHERE cl.business_id = businesses.id AND c.kind = 'followup' ORDER BY cl.id DESC LIMIT 1) AS followup
       FROM businesses ${where} ${leadOrder(f)} LIMIT ? OFFSET ?`,
      ...params,
      PAGE,
      page * PAGE,
    ),
  ]);
  return json({
    total,
    page,
    pageSize: PAGE,
    rows: rows.map(({ audit, ...r }) => {
      const fu = (r as { followup: string | null }).followup?.split("/");
      const { lat, lng } = r as { lat: number | null; lng: number | null };
      let tz: string | null = null;
      try {
        tz = lat != null && lng != null ? tzlookup(lat, lng) : null;
      } catch {}
      return {
        ...r,
        tz, // the business's time zone, for "local time" on the call list
        ...auditSummary(audit),
        followup: fu ? { step: Number(fu[0]), steps: Number(fu[1]), state: fu[2], nextSendAt: Number(fu[3]) || null } : null,
      };
    }),
  });
}

type Selection = { ids?: number[]; filter?: Record<string, string | null> };

// Bulk actions on selected leads, or on every lead matching a filter ("select all").
export async function PATCH(req: Request) {
  const b = await body<Selection & { action: "exclude" | "include" | "retry" | "audit" | "followup" }>(req);
  const ids = await resolveIds(b);
  if (ids.length === 0) return bad("No leads selected");
  let changed = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300);
    const m = marks(part.length);
    if (b.action === "exclude") changed += (await db.run(`UPDATE businesses SET status = 'excluded' WHERE id IN (${m})`, ...part)).changes;
    else if (b.action === "include")
      changed += (await db.run(`UPDATE businesses SET status = 'verified' WHERE id IN (${m}) AND status = 'excluded' AND email IS NOT NULL`, ...part)).changes;
    else if (b.action === "retry")
      changed += (
        await db.run(
          `UPDATE businesses SET status = 'pending', enrich_attempts = 0 WHERE id IN (${m}) AND website IS NOT NULL AND status IN ('no_email','invalid')`,
          ...part,
        )
      ).changes;
    else if (b.action === "audit") changed += (await db.run(`UPDATE businesses SET audit_status = 'queued' WHERE id IN (${m})`, ...part)).changes;
    else if (b.action === "followup") {
      for (const id of part) if (!(await startFollowup(id))) changed++;
    } else return bad("Unknown action");
  }
  return json({ ok: true, selected: ids.length, changed });
}

// Permanently delete leads. remember (default true): re-running a search won't bring them back.
export async function DELETE(req: Request) {
  const b = await body<Selection & { remember?: boolean }>(req);
  const ids = await resolveIds(b);
  if (ids.length === 0) return bad("No leads selected");
  return json({ ok: true, deleted: await deleteLeads(ids, b.remember !== false) });
}
