import pLimit from "p-limit";
import { db, logEvent, now } from "../db";
import { crawlForEmail } from "./crawl";
import { verifyEmail } from "./verify";
import { isSuppressed } from "../outreach/suppression";

type Row = { id: number; website: string | null; domain: string | null; email: string | null; email_source: string | null };

const CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 10);
const MIN_CONFIDENCE = 35;

/** Enrich one batch of pending businesses. Returns how many were processed. */
export async function enrichBatch(batchSize = 40): Promise<number> {
  const rows = await db.all<Row>(
    `SELECT id, website, domain, email, email_source FROM businesses
     WHERE status = 'pending' AND enrich_attempts < 3 ORDER BY id LIMIT ?`,
    batchSize,
  );
  if (rows.length === 0) return 0;

  const save = (p: { id: number; status: string; email: string | null; emailSource: string | null; confidence: number | null; summary: string | null; at: number }) =>
    db.run(
      `UPDATE businesses SET status = @status, email = @email, email_source = @emailSource,
        email_confidence = @confidence, site_summary = COALESCE(@summary, site_summary), enriched_at = @at,
        enrich_attempts = enrich_attempts + 1 WHERE id = @id`,
      p,
    );

  // One request at a time per host: rows are already de-duplicated by domain.
  const limit = pLimit(CONCURRENCY);
  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        try {
          let email = row.email;
          let emailSource = row.email_source;
          let confidence: number | null = row.email ? 70 : null;
          let summary: string | null = null;

          if (row.website) {
            const r = await crawlForEmail(row.website, row.domain);
            summary = r.summary;
            if (r.best && r.best.score >= MIN_CONFIDENCE && (!email || r.best.score > 70)) {
              email = r.best.email;
              emailSource = r.best.source;
              confidence = r.best.score;
            }
          }

          if (!email) {
            await save({ id: row.id, status: "no_email", email: null, emailSource: null, confidence: null, summary, at: now() });
            return;
          }
          const v = await verifyEmail(email);
          const status = !v.ok ? "invalid" : (await isSuppressed(email)) ? "excluded" : "verified";
          await save({ id: row.id, status, email, emailSource, confidence, summary, at: now() });
        } catch (e) {
          await db.run("UPDATE businesses SET enrich_attempts = enrich_attempts + 1 WHERE id = ?", row.id);
          await logEvent("warn", `Enrich business #${row.id} failed: ${e instanceof Error ? e.message : e}`);
        }
      }),
    ),
  );
  // Anything that exhausted its retries without a result.
  await db.run("UPDATE businesses SET status = 'no_email' WHERE status = 'pending' AND enrich_attempts >= 3");
  return rows.length;
}
