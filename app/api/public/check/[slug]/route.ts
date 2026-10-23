import { connection } from "next/server";
import { db } from "@/lib/db";
import { publicAuthorized, unauthorized } from "@/lib/public-api";
import { storedCheck } from "@/lib/check/run-check";

// What a results page on bouldhq.com shows: the saved check, no new Google call. Only what the
// owner should see: their row, the top 3 and the one-line fix. Never call notes or priorities.
//
// Google's terms allow caching Places data (names, ratings, review counts) for up to 30 days,
// so a link whose check is older than that stops working until the check is re-run.
const MAX_AGE = 30 * 86_400_000;

export async function GET(req: Request, ctx: RouteContext<"/api/public/check/[slug]">) {
  await connection();
  if (!publicAuthorized(req)) return unauthorized();
  const slug = (await ctx.params).slug;
  const row = await db.get<{ name: string; city: string | null; top_check: string | null; checked_at: number | null }>(
    "SELECT name, city, top_check, checked_at FROM businesses WHERE check_slug = ?",
    slug,
  );
  const c = row ? storedCheck(row) : null;
  if (!row || !c || !row.checked_at || Date.now() - row.checked_at > MAX_AGE) return Response.json({ error: "Not found" }, { status: 404 });

  const top3 = c.top.slice(0, 3).map((t, i) => ({ name: t.name, rating: t.rating, reviews: t.reviews, rank: i + 1, you: !!c.lead.placeId && t.id === c.lead.placeId }));
  const rows = top3.some((r) => r.you) ? top3 : [...top3, { name: c.lead.name || row.name, rating: c.lead.rating, reviews: c.lead.reviews, rank: c.rank, you: true }];
  return Response.json({
    name: c.lead.name || row.name,
    city: c.city ?? row.city,
    query: c.query,
    rank: c.rank,
    case: c.diagnosis.case,
    title: c.diagnosis.title,
    say: c.diagnosis.say,
    rows,
    checkedAt: c.at,
  });
}
