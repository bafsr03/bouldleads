import crypto from "node:crypto";
import { db, logEvent, now } from "../db";
import { getSys, setSys } from "../settings";
import { claimNext, finish } from "../jobs";
import { runSearch } from "../discovery/run-search";
import { enrichBatch } from "../enrich/run-enrich";
import { auditBatch } from "../audit/run-audit";
import { sendTick } from "../outreach/scheduler";
import { syncAllInboxes } from "../outreach/imap-sync";

// All background work in one bounded pass, so it runs the same way from a cron request on Vercel
// (every minute, max ~5 min each) and from the local worker loop. Each part saves its progress,
// so whatever doesn't fit continues on the next tick.

const IMAP_EVERY = 5 * 60_000;
const LOCK_MS = 6 * 60_000; // longer than one tick can run

/** Take the tick lease; false if another tick holds it. */
async function lock(owner: string): Promise<boolean> {
  const r = await db.run(
    `INSERT INTO settings (key, value) VALUES ('sys:tickLock', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
     WHERE CAST(substr(settings.value, 1, instr(settings.value, ':') - 1) AS INTEGER) < ?`,
    `${now() + LOCK_MS}:${owner}`,
    now(),
  );
  return r.changes > 0;
}

async function unlock(owner: string) {
  await db.run("DELETE FROM settings WHERE key = 'sys:tickLock' AND value LIKE ?", `%:${owner}`);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    await logEvent("error", `${name}: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
  }
}

export type TickReport = { ran: boolean; searches: number; enriched: number; audited: number; sent: number; imap: boolean; ms: number };

export async function runTick(budgetMs = 240_000): Promise<TickReport> {
  const started = Date.now();
  const deadline = started + budgetMs;
  const left = () => deadline - Date.now();
  // Reserve time to finish what's started: a quarter of the budget, at most 60 s.
  const reserve = Math.min(60_000, budgetMs / 4);
  const report: TickReport = { ran: false, searches: 0, enriched: 0, audited: 0, sent: 0, imap: false, ms: 0 };
  const owner = crypto.randomUUID();
  if (!(await lock(owner))) return report;
  report.ran = true;
  try {
    await setSys("lastTick", String(now()));

    // 1. Emails due now go first: they're time-sensitive and quick.
    while (left() > reserve / 2 && (await step("send", sendTick))) report.sent++;

    // 2. Searches (Google + OpenStreetMap). Uses at most half the budget so enrichment keeps moving.
    const searchDeadline = Date.now() + Math.max(0, left() / 2);
    while (left() > reserve / 2 && Date.now() < searchDeadline) {
      const job = await claimNext();
      if (!job) break;
      try {
        const done = job.type === "search" ? await runSearch(JSON.parse(job.payload).searchId, searchDeadline) : true;
        await finish(job.id, done ? {} : { requeue: true });
        report.searches++;
      } catch (e) {
        await finish(job.id, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 3. Find emails, then audit, in small batches until the budget runs low.
    while (left() > reserve) {
      const n = (await step("enrich", () => enrichBatch(20))) ?? 0;
      report.enriched += n;
      if (n === 0) break;
    }
    while (left() > reserve) {
      const n = (await step("audit", () => auditBatch(8))) ?? 0;
      report.audited += n;
      if (n === 0) break;
    }

    // 4. Replies, bounces and opt-outs.
    const lastImap = Number((await getSys("lastImap")) ?? 0);
    if (now() - lastImap > IMAP_EVERY && left() > reserve / 2) {
      await setSys("lastImap", String(now()));
      await step("imap", syncAllInboxes);
      report.imap = true;
    }

    // 5. Anything that came due meanwhile.
    while (left() > reserve / 4 && (await step("send", sendTick))) report.sent++;
  } finally {
    await unlock(owner);
    report.ms = Date.now() - started;
  }
  return report;
}

/** True when there's background work waiting (the local worker loops quickly while busy). */
export async function hasWork(): Promise<boolean> {
  const n = await db.count(
    `SELECT (SELECT COUNT(*) FROM jobs WHERE status = 'queued')
          + (SELECT COUNT(*) FROM businesses WHERE status = 'pending' AND enrich_attempts < 3)
          + (SELECT COUNT(*) FROM businesses WHERE audit_status = 'queued')`,
  );
  return n > 0;
}
