import { db, now } from "../db";

export type SuppressionReason = "unsubscribed" | "bounced" | "replied" | "manual" | "complaint" | "do_not_call";

export async function isSuppressed(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  const domain = "@" + e.split("@")[1];
  return !!(await db.get("SELECT 1 FROM suppressions WHERE value IN (?, ?) LIMIT 1", e, domain));
}

/** value is an email address or "@domain.com" to block a whole domain. */
export async function suppress(value: string, reason: SuppressionReason) {
  const v = value.trim().toLowerCase();
  if (!v) return;
  // Mark matching businesses so they never get picked into a campaign.
  await db.batch([
    ["INSERT OR IGNORE INTO suppressions (value, reason, created_at) VALUES (?, ?, ?)", v, reason, now()],
    v.startsWith("@")
      ? ["UPDATE businesses SET status = 'excluded' WHERE email LIKE ?", `%${v}`]
      : ["UPDATE businesses SET status = 'excluded' WHERE email = ?", v],
  ]);
}
