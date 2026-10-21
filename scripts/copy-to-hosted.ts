import { hostedToken, hostedUrl, localDbUrl, openClient } from "../lib/db";
import { copyDatabase } from "../lib/copy-db";

// Usage: TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run copy-to-hosted [-- --force]
// Copies data/bouldleads.db (this computer) into the hosted database.

async function main() {
  const url = hostedUrl();
  if (!url) {
    console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (vercel env pull .env.local, then: set -a; source .env.local; set +a).");
    process.exit(1);
  }
  const src = await openClient(localDbUrl());
  const dst = await openClient(url, hostedToken());
  console.log(`Copying ${localDbUrl()} → ${url}`);
  await copyDatabase(src, dst, { force: process.argv.includes("--force"), log: (s) => console.log("  " + s) });
  console.log("Done. Inboxes and API keys aren't copied: add them in the hosted app's Settings and Inboxes pages.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
