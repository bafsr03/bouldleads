import { connection } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/api";

// Leads someone deleted with "don't add them back". Searches skip these businesses.
export async function GET() {
  await connection();
  return json({ count: await db.count("SELECT COUNT(*) FROM dismissed") });
}

// Forget the list: the next search of those areas finds those businesses again.
export async function DELETE() {
  const r = await db.run("DELETE FROM dismissed");
  return json({ ok: true, cleared: r.changes });
}
