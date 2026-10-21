import { connection } from "next/server";
import { json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { dailyCallLog } from "@/lib/calls";

// Daily call counter: ?tz=America/Denver&days=14&who=me|all. Days are the caller's own days.
export async function GET(req: Request) {
  await connection();
  const sp = new URL(req.url).searchParams;
  const tz = sp.get("tz") || "UTC";
  const me = await currentUser();
  const user = sp.get("who") === "all" ? null : me;
  return json({ ...(await dailyCallLog({ tz, days: Number(sp.get("days")) || 14, user })), user, loginsOn: !!me });
}
