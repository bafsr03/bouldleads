import { body, bad, json } from "@/lib/api";
import { GoogleBudgetError } from "@/lib/discovery/google-api";
import { runTopCheck } from "@/lib/check/run-check";
import { rescore } from "@/lib/audit/run-audit";

// "Re-run" on the lead card: the top-3 check again, fresh from Google, optionally with a new search.
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/leads/[id]/check">) {
  const id = Number((await ctx.params).id);
  const b = await body<{ query?: string }>(req);
  const query = typeof b.query === "string" ? b.query.trim().slice(0, 120) : undefined;
  try {
    const check = await runTopCheck(id, { query: query || undefined, force: true });
    if (!check) return bad("Couldn't run the check: this lead needs a search term and a city (or map location), and Google needs a key in Settings.", 422);
    await rescore(id).catch(() => null);
    return json({ ok: true, check });
  } catch (e) {
    if (e instanceof GoogleBudgetError) return bad(e.message, 429);
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}
