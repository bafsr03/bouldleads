import { connection } from "next/server";
import { db } from "@/lib/db";
import { bad, body, json } from "@/lib/api";
import { suppress } from "@/lib/outreach/suppression";

export async function GET() {
  await connection();
  return json(await db.all("SELECT * FROM suppressions ORDER BY created_at DESC LIMIT 1000"));
}

// Add one or many (newline/comma separated) emails or @domains.
export async function POST(req: Request) {
  const { values } = await body<{ values: string }>(req);
  const list = (values ?? "")
    .split(/[\s,;]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(v));
  if (list.length === 0) return bad("Enter emails or @domains.");
  for (const v of list) await suppress(v, "manual");
  return json({ added: list.length });
}

export async function DELETE(req: Request) {
  const value = new URL(req.url).searchParams.get("value");
  if (!value) return bad("Missing value");
  await db.run("DELETE FROM suppressions WHERE value = ? AND reason = 'manual'", value);
  return json({ ok: true });
}
