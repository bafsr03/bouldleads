import { connection } from "next/server";
import { json } from "@/lib/api";
import { authEnabled, currentUser } from "@/lib/auth";
import { getSys, setSys } from "@/lib/settings";

// Who's signed in, and whether they've seen the welcome tour (stored per person).
const tourKey = (user: string | null) => `onboarded:${user ?? "local"}`;

export async function GET() {
  await connection();
  const user = await currentUser();
  return json({ user, authEnabled: authEnabled(), onboarded: !!(await getSys(tourKey(user))) });
}

// POST = the welcome tour was finished or skipped.
export async function POST() {
  await setSys(tourKey(await currentUser()), String(Date.now()));
  return json({ ok: true });
}
