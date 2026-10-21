import { bad, body, int, json } from "@/lib/api";
import { testConnection } from "@/lib/outreach/inboxes";
import type { InboxInput } from "../route";

// Test SMTP/IMAP credentials before saving an inbox.
export async function POST(req: Request) {
  const b = await body<InboxInput>(req);
  if (!b.email || !b.smtpHost) return bad("Email and SMTP host are required.");
  return json(
    await testConnection({
      email: b.email,
      smtpHost: b.smtpHost,
      smtpPort: int(b.smtpPort),
      smtpSecure: !!b.smtpSecure,
      imapHost: b.imapHost || null,
      imapPort: b.imapPort ? int(b.imapPort) : null,
      imapSecure: b.imapSecure ?? true,
      username: b.username || b.email,
      password: b.password ?? "",
    }),
  );
}
