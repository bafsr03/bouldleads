import crypto from "node:crypto";
import { db } from "@/lib/db";
import { bad, json } from "@/lib/api";
import { makeSlug } from "@/lib/check/diagnose";
import { SITE_URL } from "@/lib/public-api";

// "Copy results link": bouldhq.com/check/<slug> for this lead. Made once and kept, so a link
// already texted to the owner keeps working; the page always shows the latest saved check.
export async function POST(_req: Request, ctx: RouteContext<"/api/leads/[id]/check/link">) {
  const id = Number((await ctx.params).id);
  const row = await db.get<{ name: string; city: string | null; check_slug: string | null; top_check: string | null }>(
    "SELECT name, city, check_slug, top_check FROM businesses WHERE id = ?",
    id,
  );
  if (!row) return bad("Not found", 404);
  if (!row.top_check) return bad("Run the top-3 check first: the link shows its results.", 422);
  let slug = row.check_slug;
  for (let i = 0; !slug && i < 5; i++) {
    const s = makeSlug(row.name, row.city, crypto.randomBytes(3).toString("hex").slice(0, 4));
    try {
      await db.run("UPDATE businesses SET check_slug = ? WHERE id = ? AND check_slug IS NULL", s, id);
      slug = s;
    } catch {
      // Unique index: that code is taken, try another.
    }
  }
  if (!slug) return bad("Couldn't make a link, try again.", 500);
  return json({ ok: true, slug, url: `${SITE_URL()}/check/${slug}` });
}
