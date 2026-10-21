import crypto from "node:crypto";
import { db, logEvent, now } from "../db";
import { getSettings, type Settings } from "../settings";
import { personalLine } from "./personalize";
import { allowedToday, connFromRow, localDate, smtpTransport, zoned, type InboxRow } from "./inboxes";
import { renderStep, type BusinessRow, type Step } from "./campaigns";
import { isSuppressed, suppress } from "./suppression";
import { toHtml } from "./render";

type DueLead = {
  id: number;
  campaign_id: number;
  business_id: number;
  email: string;
  inbox_id: number | null;
  step: number;
  personal_line: string | null;
  thread_message_id: string | null;
  thread_subject: string | null;
  steps: string;
};

const DAY = 86_400_000;

export function inSendWindow(s: Settings, d = new Date()): boolean {
  const t = zoned(d, s.timezone);
  return s.sendDays.includes(t.day) && t.hour >= s.sendWindowStart && t.hour < s.sendWindowEnd;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function dueLeadFor(inboxId: number): Promise<DueLead | undefined> {
  // No-answer follow-ups first (someone is waiting on a call-back), then later steps, so sequences finish before new leads start.
  return db.get<DueLead>(
    `SELECT cl.*, c.steps FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
     WHERE c.status = 'active' AND cl.state IN ('queued', 'in_sequence') AND cl.next_send_at <= ?
       AND (cl.inbox_id = ? OR (cl.inbox_id IS NULL AND EXISTS (SELECT 1 FROM json_each(c.inbox_ids) WHERE value = ?)))
     ORDER BY c.kind = 'followup' DESC, cl.step DESC, cl.next_send_at, cl.id LIMIT 1`,
    now(),
    inboxId,
    inboxId,
  );
}

/**
 * One scheduler pass: each eligible inbox sends at most one email (inboxes are spaced by their
 * random gap). Returns true if anything was sent.
 */
export async function sendTick(): Promise<boolean> {
  const s = await getSettings();
  if (!s.emailOutreach || !inSendWindow(s)) return false;

  const inboxes = await db.all<InboxRow>(
    `SELECT * FROM inboxes i WHERE active = 1 AND EXISTS (
       SELECT 1 FROM campaigns c, json_each(c.inbox_ids) j WHERE c.status = 'active' AND j.value = i.id)`,
  );

  const today = localDate(s.timezone);
  let sent = false;
  for (const inbox of inboxes) {
    if (inbox.sent_date !== today) {
      await db.run("UPDATE inboxes SET sent_date = ?, sent_today = 0 WHERE id = ?", today, inbox.id);
      inbox.sent_today = 0;
    }
    if (inbox.sent_today >= allowedToday(inbox, s.warmupStartPerDay, s.warmupIncrementPerDay)) continue;
    if (now() < inbox.next_send_at) continue;
    const lead = await dueLeadFor(inbox.id);
    if (!lead) continue;
    await sendOne(inbox, lead, s);
    sent = true;
  }

  // Close campaigns with nothing left to send. The no-answer follow-up stays open: leads join it any time.
  await db.run(
    `UPDATE campaigns SET status = 'completed' WHERE status = 'active' AND kind != 'followup' AND NOT EXISTS (
       SELECT 1 FROM campaign_leads cl WHERE cl.campaign_id = campaigns.id AND cl.state IN ('queued', 'in_sequence'))`,
  );
  return sent;
}

async function sendOne(inbox: InboxRow, lead: DueLead, s: Settings) {
  const steps = JSON.parse(lead.steps) as Step[];
  const step = steps[lead.step];
  const setLead = (state: string, error: string | null) =>
    db.run("UPDATE campaign_leads SET state = ?, last_error = ?, next_send_at = 0, updated_at = ? WHERE id = ?", state, error, now(), lead.id);
  if (!step) return setLead("completed", null);
  if (await isSuppressed(lead.email)) return setLead("unsubscribed", "suppressed");

  const b = await db.get<BusinessRow & { dnc: number }>("SELECT * FROM businesses WHERE id = ?", lead.business_id);
  if (!b) return setLead("skipped", "business deleted");
  if (b.dnc) return setLead("stopped", "do not contact");

  // Generate the AI opener once per lead, only if a template uses it.
  let line = lead.personal_line;
  if (line === null && s.aiProvider !== "none" && steps.some((st) => st.body.includes("personal_line"))) {
    try {
      line = (await personalLine({ name: b.name, category: b.category, city: b.city, siteSummary: b.site_summary })) ?? "";
    } catch (e) {
      await logEvent("warn", `AI personalization failed for lead #${lead.id}: ${e instanceof Error ? e.message : e}`);
      line = "";
    }
    await db.run("UPDATE campaign_leads SET personal_line = ? WHERE id = ?", line, lead.id);
  }

  const { subject, body } = await renderStep(step, lead.step, b, inbox.from_name, line || null, lead.thread_subject);
  const senderDomain = inbox.email.split("@")[1];
  const messageId = `<${crypto.randomUUID()}@${senderDomain}>`;
  const threadHeaders = lead.thread_message_id
    ? { inReplyTo: lead.thread_message_id, references: [lead.thread_message_id] }
    : {};

  try {
    await smtpTransport(connFromRow(inbox)).sendMail({
      from: { name: inbox.from_name, address: inbox.email },
      to: lead.email,
      subject,
      text: body,
      html: toHtml(body),
      messageId,
      ...threadHeaders,
      headers: { "List-Unsubscribe": `<mailto:${inbox.email}?subject=unsubscribe>` },
    });
  } catch (e) {
    const err = e as { responseCode?: number; message?: string; code?: string };
    const msg = err.message ?? String(e);
    if (err.responseCode && err.responseCode >= 550 && err.responseCode <= 553 && /recipient|mailbox|user|address/i.test(msg)) {
      // Hard bounce at SMTP time.
      await suppress(lead.email, "bounced");
      return setLead("bounced", msg.slice(0, 500));
    }
    // Transient or account problem: back off this inbox and retry the lead later.
    const backoff = err.responseCode === 535 || err.code === "EAUTH" ? 60 * 60_000 : 15 * 60_000;
    await db.batch([
      ["UPDATE inboxes SET last_error = ?, next_send_at = ? WHERE id = ?", msg.slice(0, 500), now() + backoff, inbox.id],
      ["UPDATE campaign_leads SET last_error = ?, next_send_at = ?, updated_at = ? WHERE id = ?", msg.slice(0, 500), now() + 30 * 60_000, now(), lead.id],
    ]);
    await logEvent("warn", `Send failed from ${inbox.email} to ${lead.email}: ${msg}`);
    return;
  }

  const sentAt = now();
  const next = steps[lead.step + 1];
  await db.batch([
    ["INSERT INTO messages (campaign_lead_id, inbox_id, step, message_id, subject, sent_at) VALUES (?, ?, ?, ?, ?, ?)", lead.id, inbox.id, lead.step, messageId, subject, sentAt],
    [
      `UPDATE campaign_leads SET inbox_id = ?, step = step + 1, state = ?, next_send_at = ?, last_error = NULL,
         thread_message_id = COALESCE(thread_message_id, ?), thread_subject = COALESCE(thread_subject, ?), updated_at = ?
       WHERE id = ?`,
      inbox.id,
      next ? "in_sequence" : "completed",
      next ? sentAt + Math.max(1, next.delayDays) * DAY : 0,
      messageId,
      subject,
      sentAt,
      lead.id,
    ],
    [
      "UPDATE inboxes SET sent_today = sent_today + 1, next_send_at = ?, last_error = NULL WHERE id = ?",
      sentAt + rand(s.minGapSeconds, s.maxGapSeconds) * 1000,
      inbox.id,
    ],
  ]);
}
