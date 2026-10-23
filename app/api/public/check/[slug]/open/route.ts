import { db, now } from "@/lib/db";
import { publicAuthorized, unauthorized } from "@/lib/public-api";

// The owner opened their results link: "Opened" on the lead card, a cue for a follow-up call.
export async function POST(req: Request, ctx: RouteContext<"/api/public/check/[slug]/open">) {
  if (!publicAuthorized(req)) return unauthorized();
  const slug = (await ctx.params).slug;
  const r = await db.run("UPDATE businesses SET check_opened_at = ?, check_opens = check_opens + 1 WHERE check_slug = ?", now(), slug);
  return Response.json({ ok: r.changes > 0 });
}
