import { connection } from "next/server";
import { db, now } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { bad, body, int, json } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { allowedToday, type InboxRow } from "@/lib/outreach/inboxes";

export type InboxInput = {
  label?: string;
  fromName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean | null;
  username?: string;
  password?: string;
  dailyCap?: number;
  warmupEnabled?: boolean;
};

export async function GET() {
  await connection();
  const s = await getSettings();
  const rows = await db.all<InboxRow>("SELECT * FROM inboxes ORDER BY id");
  const sent = Object.fromEntries(
    (await db.all<{ inbox_id: number; n: number }>("SELECT inbox_id, COUNT(*) AS n FROM messages GROUP BY inbox_id")).map((r) => [r.inbox_id, r.n]),
  );
  return json(
    rows.map((row) => {
      const r: Partial<InboxRow> = { ...row };
      delete r.password_enc; // never send credentials to the browser
      return { ...r, allowed_today: allowedToday(row, s.warmupStartPerDay, s.warmupIncrementPerDay), total_sent: sent[row.id] ?? 0 };
    }),
  );
}

export async function POST(req: Request) {
  const b = await body<InboxInput>(req);
  if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return bad("Enter a valid email address.");
  if (!b.fromName?.trim()) return bad("Enter a sender name.");
  if (!b.smtpHost || !b.smtpPort) return bad("SMTP host and port are required.");
  const r = await db.run(
    `INSERT INTO inboxes (label, from_name, email, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure,
     username, password_enc, daily_cap, warmup_enabled, warmup_start, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.label?.trim() || b.email,
    b.fromName.trim(),
    b.email.trim().toLowerCase(),
    b.smtpHost.trim(),
    int(b.smtpPort),
    b.smtpSecure ? 1 : 0,
    b.imapHost?.trim() || null,
    b.imapPort ? int(b.imapPort) : null,
    b.imapHost ? (b.imapSecure === false ? 0 : 1) : null,
    (b.username?.trim() || b.email).trim(),
    encrypt(b.password ?? ""),
    Math.min(Math.max(int(b.dailyCap, 40), 1), 500),
    b.warmupEnabled === false ? 0 : 1,
    now(),
    now(),
  );
  // New inboxes also send the no-answer follow-up.
  await db.run(
    `UPDATE campaigns SET inbox_ids = json_insert(inbox_ids, '$[#]', CAST(? AS INTEGER)) WHERE kind = 'followup'
       AND NOT EXISTS (SELECT 1 FROM json_each(campaigns.inbox_ids) WHERE value = ?)`,
    r.lastId,
    r.lastId,
  );
  return json({ id: r.lastId });
}
