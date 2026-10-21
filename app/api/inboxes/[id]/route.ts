import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { bad, body, int, json } from "@/lib/api";
import { connFromRow, getInbox, testConnection } from "@/lib/outreach/inboxes";

type Patch = { fromName?: string; dailyCap?: number; warmupEnabled?: boolean; active?: boolean; password?: string; test?: boolean };

export async function PATCH(req: Request, ctx: RouteContext<"/api/inboxes/[id]">) {
  const id = Number((await ctx.params).id);
  const inbox = await getInbox(id);
  if (!inbox) return bad("Not found", 404);
  const b = await body<Patch>(req);
  if (b.test) return json(await testConnection(connFromRow(inbox)));
  if (b.fromName !== undefined) await db.run("UPDATE inboxes SET from_name = ? WHERE id = ?", b.fromName.trim(), id);
  if (b.dailyCap !== undefined) await db.run("UPDATE inboxes SET daily_cap = ? WHERE id = ?", Math.min(Math.max(int(b.dailyCap), 1), 500), id);
  if (b.warmupEnabled !== undefined) await db.run("UPDATE inboxes SET warmup_enabled = ? WHERE id = ?", b.warmupEnabled ? 1 : 0, id);
  if (b.active !== undefined) await db.run("UPDATE inboxes SET active = ?, last_error = NULL WHERE id = ?", b.active ? 1 : 0, id);
  if (b.password) await db.run("UPDATE inboxes SET password_enc = ? WHERE id = ?", encrypt(b.password), id);
  return json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/inboxes/[id]">) {
  const id = Number((await ctx.params).id);
  const used = await db.count("SELECT COUNT(*) FROM messages WHERE inbox_id = ?", id);
  // Keep history intact: inboxes that have sent mail are deactivated instead of deleted.
  if (used > 0) await db.run("UPDATE inboxes SET active = 0 WHERE id = ?", id);
  else await db.run("DELETE FROM inboxes WHERE id = ?", id);
  return json({ ok: true, deactivated: used > 0 });
}
