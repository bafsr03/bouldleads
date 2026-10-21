import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { bad, json } from "@/lib/api";
import { deleteLeads } from "@/lib/leads";

// POST { action: "cancel" | "retry" }.
export async function POST(req: Request, ctx: RouteContext<"/api/searches/[id]">) {
  const id = Number((await ctx.params).id);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action === "cancel") {
    await db.run("UPDATE searches SET status = 'cancelled' WHERE id = ? AND status IN ('queued','running')", id);
    return json({ ok: true });
  }
  if (action === "retry") {
    // Re-runs every tile; businesses already found are de-duplicated on insert.
    const r = await db.run(
      "UPDATE searches SET status = 'queued', error = NULL, tiles_done = 0, cursor = NULL, finished_at = NULL WHERE id = ? AND status IN ('done','failed','cancelled')",
      id,
    );
    if (r.changes === 0) return bad("This search is still running.");
    await enqueue("search", { searchId: id });
    return json({ ok: true });
  }
  return bad("Unknown action");
}

// DELETE removes the search. ?withLeads=1 also deletes the leads it found (and keeps them from coming back).
export async function DELETE(req: Request, ctx: RouteContext<"/api/searches/[id]">) {
  const id = Number((await ctx.params).id);
  const withLeads = new URL(req.url).searchParams.get("withLeads") === "1";
  let deleted = 0;
  if (withLeads) {
    const ids = (await db.all<{ id: number }>("SELECT id FROM businesses WHERE search_id = ?", id)).map((r) => r.id);
    deleted = await deleteLeads(ids, true);
  }
  await db.batch([
    ["UPDATE searches SET status = 'cancelled' WHERE id = ? AND status IN ('queued','running')", id],
    ["UPDATE businesses SET search_id = NULL WHERE search_id = ?", id],
    ["DELETE FROM jobs WHERE type = 'search' AND json_extract(payload, '$.searchId') = ? AND status != 'running'", id],
    ["DELETE FROM searches WHERE id = ?", id],
  ]);
  return json({ ok: true, deleted });
}
