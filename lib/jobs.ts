import { db, now } from "./db";

// Tiny durable job queue in the database (survives restarts and spans background ticks).

export type JobType = "search";

export async function enqueue(type: JobType, payload: unknown, runAfter = 0) {
  return (await db.run("INSERT INTO jobs (type, payload, run_after, created_at) VALUES (?, ?, ?, ?)", type, JSON.stringify(payload), runAfter, now()))
    .lastId;
}

export type Job = { id: number; type: JobType; payload: string; attempts: number };

/** Claim the next due job. A job left "running" for over 10 minutes (crashed tick) is claimable again. */
export async function claimNext(): Promise<Job | undefined> {
  return db.tx(async (q) => {
    const job = await q.get<Job>(
      `SELECT id, type, payload, attempts FROM jobs
       WHERE (status = 'queued' AND run_after <= ?) OR (status = 'running' AND run_after <= ?) ORDER BY id LIMIT 1`,
      now(),
      now() - 10 * 60_000,
    );
    // While running, run_after holds the claim time so a stuck job can be reclaimed.
    if (job) await q.run("UPDATE jobs SET status = 'running', attempts = attempts + 1, run_after = ? WHERE id = ?", now(), job.id);
    return job;
  });
}

/** Done, failed, or (requeue) put back to continue on the next tick. */
export async function finish(id: number, result: { error?: string; requeue?: boolean } = {}) {
  if (result.requeue) await db.run("UPDATE jobs SET status = 'queued', run_after = 0 WHERE id = ?", id);
  else await db.run("UPDATE jobs SET status = ?, error = ? WHERE id = ?", result.error ? "failed" : "done", result.error ?? null, id);
}
