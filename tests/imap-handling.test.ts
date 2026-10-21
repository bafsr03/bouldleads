import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { simpleParser } from "mailparser";

// Own throwaway database so it can't collide with other DB tests running in parallel.
const dir = path.join(process.env.BOULDLEADS_DATA_DIR!, "imap");
process.env.BOULDLEADS_DATA_DIR = dir;

let db: typeof import("@/lib/db").db;
let processMessage: typeof import("@/lib/outreach/imap-sync").processMessage;
let isSuppressed: typeof import("@/lib/outreach/suppression").isSuppressed;
const inbox = { id: 1, email: "alex@sender.test", created_at: 0 } as import("@/lib/outreach/inboxes").InboxRow;

async function seedLead(n: number, email: string, messageId: string) {
  await db.batch([
    ["INSERT INTO businesses (id, source, source_id, name, email, status, created_at) VALUES (?, 'osm', ?, ?, ?, 'verified', 0)", n, `node/${n}`, `Biz ${n}`, email],
    ["INSERT INTO campaign_leads (id, campaign_id, business_id, email, inbox_id, step, state, updated_at) VALUES (?, 1, ?, ?, 1, 1, 'in_sequence', 0)", n, n, email],
    ["INSERT INTO messages (campaign_lead_id, inbox_id, step, message_id, subject, sent_at) VALUES (?, 1, 0, ?, 'Hi', 0)", n, messageId],
  ]);
}

const state = async (id: number) => (await db.get<{ state: string }>("SELECT state FROM campaign_leads WHERE id = ?", id))!.state;

beforeAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  db = (await import("@/lib/db")).db;
  ({ processMessage } = await import("@/lib/outreach/imap-sync"));
  ({ isSuppressed } = await import("@/lib/outreach/suppression"));
  await db.run(
    "INSERT INTO inboxes (id, label, from_name, email, smtp_host, smtp_port, smtp_secure, username, password_enc, warmup_start, created_at) VALUES (1, 'a', 'Alex', 'alex@sender.test', 'localhost', 1025, 0, 'a', 'x', 0, 0)",
  );
  await db.run("INSERT INTO campaigns (id, name, steps, inbox_ids, lead_filter, status, created_at) VALUES (1, 't', '[]', '[1]', '{}', 'active', 0)");
  await seedLead(1, "owner@reply.test", "<m1@sender.test>");
  await seedLead(2, "info@optout.test", "<m2@sender.test>");
  await seedLead(3, "gone@bounce.test", "<m3@sender.test>");
  await seedLead(4, "boss@ooo.test", "<m4@sender.test>");
});

describe("IMAP message processing", () => {
  it("marks a threaded reply as replied without suppressing", async () => {
    const raw = `From: Owner <owner@reply.test>\r\nTo: alex@sender.test\r\nSubject: Re: Hi\r\nIn-Reply-To: <m1@sender.test>\r\nMessage-ID: <r1@reply.test>\r\n\r\nSure, send it over!\r\n`;
    await processMessage(inbox, await simpleParser(raw));
    expect(await state(1)).toBe("replied");
    expect(await isSuppressed("owner@reply.test")).toBe(false);
  });

  it("suppresses opt-out replies matched by sender address", async () => {
    const raw = `From: info@optout.test\r\nTo: alex@sender.test\r\nSubject: Re: Hi\r\nMessage-ID: <r2@optout.test>\r\n\r\nPlease remove us from your list.\r\n`;
    await processMessage(inbox, await simpleParser(raw));
    expect(await state(2)).toBe("unsubscribed");
    expect(await isSuppressed("info@optout.test")).toBe(true);
  });

  it("detects a DSN bounce via the quoted Message-ID and suppresses the address", async () => {
    const raw = [
      "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      "To: alex@sender.test",
      "Subject: Delivery Status Notification (Failure)",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain",
      "",
      "Address not found: gone@bounce.test",
      "--b",
      "Content-Type: text/rfc822-headers",
      "",
      "Message-ID: <m3@sender.test>",
      "To: gone@bounce.test",
      "--b--",
      "",
    ].join("\r\n");
    await processMessage(inbox, await simpleParser(raw));
    expect(await state(3)).toBe("bounced");
    expect(await isSuppressed("gone@bounce.test")).toBe(true);
  });

  it("ignores out-of-office auto-replies", async () => {
    const raw = `From: boss@ooo.test\r\nTo: alex@sender.test\r\nSubject: Automatic reply: Hi\r\nAuto-Submitted: auto-replied\r\nIn-Reply-To: <m4@sender.test>\r\n\r\nI'm away until Monday.\r\n`;
    await processMessage(inbox, await simpleParser(raw));
    expect(await state(4)).toBe("in_sequence");
  });

  it("records replies for the dashboard", async () => {
    const kinds = (await db.all<{ kind: string }>("SELECT kind FROM replies ORDER BY id")).map((r) => r.kind);
    expect(kinds).toEqual(["reply", "unsubscribe", "bounce"]);
    expect(path.isAbsolute(dir)).toBe(true);
  });
});
