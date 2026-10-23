import { body } from "@/lib/api";
import { intake, type IntakeInput } from "@/lib/check/intake";
import { publicAuthorized, unauthorized } from "@/lib/public-api";

// Ranking-check requests and results-page callbacks from bouldhq.com (its /api/lead forwards them).
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!publicAuthorized(req)) return unauthorized();
  const b = await body<IntakeInput>(req);
  if (b.kind !== "site" && b.kind !== "callback") return Response.json({ ok: false, error: "kind must be site or callback" }, { status: 400 });
  try {
    const r = await intake(b);
    return Response.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
