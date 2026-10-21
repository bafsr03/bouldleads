import { logEvent } from "@/lib/db";
import { hasWork, runTick } from "@/lib/tasks/tick";

// Local background worker: runs the same tick the hosted app runs from /api/cron/tick.
// Started by `npm run dev` / `npm start` alongside Next.js.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stopping = false;

async function main() {
  console.log("Worker started");
  const shutdown = () => {
    stopping = true;
    console.log("Worker stopping…");
    setTimeout(() => process.exit(0), 1500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    try {
      const r = await runTick(60_000);
      if (r.ran && (r.searches || r.enriched || r.audited || r.sent)) console.log(`tick: ${JSON.stringify(r)}`);
      await sleep((await hasWork()) ? 500 : 10_000);
    } catch (e) {
      await logEvent("error", `worker: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
      await sleep(10_000);
    }
  }
}

main();
