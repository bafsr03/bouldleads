import { simpleParser, type ParsedMail } from "mailparser";
import { db, logEvent, now } from "../db";
import { connFromRow, imapClient, type InboxRow } from "./inboxes";
import { suppress } from "./suppression";

// Reads each inbox over IMAP to detect replies, opt-outs and bounces.
// A reply stops the sequence; opt-outs and bounces are suppressed forever.

const OPT_OUT = /\b(unsubscribe|remove me|remove|opt[\s-]?out|stop emailing|take me off|do not (contact|email)|not interested|no thanks)\b/i;
const AUTO_REPLY = /(out of (the )?office|automatic reply|auto-?reply|autoreply|abwesenheit|absence|vacation|away from)/i;

function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^>/.test(l) || /^On .+wrote:$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

export function classify(mail: Pick<ParsedMail, "from" | "subject" | "headers" | "text">): "bounce" | "auto" | "unsubscribe" | "reply" {
  const from = mail.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const ctype = String(mail.headers.get("content-type") ?? "");
  if (/mailer-daemon|postmaster/.test(from) || /report-type=["']?delivery-status/i.test(ctype)) return "bounce";
  const autoSubmitted = String(mail.headers.get("auto-submitted") ?? "");
  if ((autoSubmitted && autoSubmitted !== "no") || AUTO_REPLY.test(mail.subject ?? "")) return "auto";
  const fresh = stripQuoted(mail.text ?? "").slice(0, 400);
  if (OPT_OUT.test(fresh) || /unsubscribe/i.test(mail.subject ?? "")) return "unsubscribe";
  return "reply";
}

type LeadRef = { id: number; email: string };

async function leadByMessageIds(ids: string[]): Promise<LeadRef | undefined> {
  for (const id of ids) {
    const r = await db.get<LeadRef>(
      "SELECT cl.id, cl.email FROM messages m JOIN campaign_leads cl ON cl.id = m.campaign_lead_id WHERE m.message_id = ? LIMIT 1",
      id.trim(),
    );
    if (r) return r;
  }
}

function leadByEmail(email: string): Promise<LeadRef | undefined> {
  return db.get<LeadRef>(
    "SELECT id, email FROM campaign_leads WHERE email = ? AND state NOT IN ('queued') ORDER BY updated_at DESC LIMIT 1",
    email.toLowerCase(),
  );
}

export async function processMessage(inbox: InboxRow, mail: ParsedMail) {
  const kind = classify(mail);
  if (kind === "auto") return;

  const refs = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : mail.references ? [mail.references] : [])]
    .filter((x): x is string => !!x);
  let lead: LeadRef | undefined;

  if (kind === "bounce") {
    // DSNs quote the original Message-ID and recipient in the body or attached headers.
    const blob = [mail.text ?? "", ...mail.attachments.map((a) => (a.content.length < 200_000 ? a.content.toString("utf8") : ""))].join("\n");
    const mids = blob.match(/<[^<>\s]+@[^<>\s]+>/g) ?? [];
    lead = await leadByMessageIds([...refs, ...mids]);
    if (!lead) {
      const emails = blob.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
      for (const e of emails) if (e !== inbox.email.toLowerCase() && (lead = await leadByEmail(e))) break;
    }
    if (!lead) return;
    await suppress(lead.email, "bounced");
    await db.run("UPDATE campaign_leads SET state = 'bounced', updated_at = ? WHERE id = ?", now(), lead.id);
  } else {
    const from = mail.from?.value?.[0]?.address?.toLowerCase();
    lead = (await leadByMessageIds(refs)) ?? (from ? await leadByEmail(from) : undefined);
    if (!lead) return;
    if (kind === "unsubscribe") {
      await suppress(lead.email, "unsubscribed");
      if (from && from !== lead.email) await suppress(from, "unsubscribed");
    }
    await db.run("UPDATE campaign_leads SET state = ?, updated_at = ? WHERE id = ?", kind === "unsubscribe" ? "unsubscribed" : "replied", now(), lead.id);
  }

  await db.run(
    "INSERT INTO replies (campaign_lead_id, inbox_id, kind, from_email, subject, snippet, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    lead.id,
    inbox.id,
    kind,
    mail.from?.value?.[0]?.address ?? null,
    mail.subject ?? null,
    stripQuoted(mail.text ?? "").slice(0, 600),
    (mail.date ?? new Date()).getTime(),
  );
}

export async function syncInbox(inbox: InboxRow) {
  const conn = connFromRow(inbox);
  const client = imapClient(conn);
  if (!client) return;
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const mb = client.mailbox;
    if (!mb) return;
    let lastUid = inbox.imap_last_uid;
    const validity = String(mb.uidValidity);
    if (inbox.imap_uid_validity !== validity) {
      // New mailbox or UIDs were reset: only look at mail that arrives from now on.
      lastUid = Math.max(0, Number(mb.uidNext) - 1);
      if (inbox.imap_uid_validity === null) {
        // First sync: start at the first message received since the inbox was added.
        const since = await client.search({ since: new Date(inbox.created_at) }, { uid: true });
        if (since && since.length) lastUid = Math.min(...since) - 1;
      }
      await db.run("UPDATE inboxes SET imap_uid_validity = ?, imap_last_uid = ? WHERE id = ?", validity, lastUid, inbox.id);
    }
    let maxUid = lastUid;
    let count = 0;
    for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true, internalDate: true }, { uid: true })) {
      if (msg.uid <= lastUid) continue;
      maxUid = Math.max(maxUid, msg.uid);
      const received = msg.internalDate ? new Date(msg.internalDate).getTime() : now();
      if (received < inbox.created_at || !msg.source) continue;
      try {
        await processMessage(inbox, await simpleParser(msg.source));
      } catch (e) {
        await logEvent("warn", `IMAP message ${msg.uid} in ${inbox.email} failed: ${e instanceof Error ? e.message : e}`);
      }
      if (++count >= 500) break;
    }
    await db.run("UPDATE inboxes SET imap_last_uid = ? WHERE id = ?", maxUid, inbox.id);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

export async function syncAllInboxes() {
  const inboxes = await db.all<InboxRow>("SELECT * FROM inboxes WHERE active = 1 AND imap_host IS NOT NULL");
  for (const inbox of inboxes) {
    try {
      await syncInbox(inbox);
    } catch (e) {
      await logEvent("warn", `IMAP sync failed for ${inbox.email}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
