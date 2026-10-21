import { connection } from "next/server";
import { bad, json } from "@/lib/api";
import { runTick } from "@/lib/tasks/tick";

// Background work for the hosted app. Called every minute by an external scheduler (cron-job.org)
// and once a day by Vercel Cron as a fallback. Protected by CRON_SECRET.
export const maxDuration = 300;

export async function GET(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret) return bad("Set CRON_SECRET to enable background tasks.", 503);
  const auth = req.headers.get("authorization");
  const params = new URL(req.url).searchParams;
  if (auth !== `Bearer ${secret}` && params.get("key") !== secret) return bad("Unauthorized", 401);
  // ?budget=25 (seconds) keeps each run inside the caller's timeout (cron-job.org waits 30 s).
  const budget = Math.min(240, Math.max(10, Number(params.get("budget")) || 240));
  return json(await runTick(budget * 1000));
}
