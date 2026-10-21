import { findDuplicates, loadDupCandidates, mergeDuplicates } from "../lib/dedupe";

// Usage: npm run dedupe -- [--dry-run]
// Finds leads that are the same business (same Google listing; same phone or website and a similar
// name; the same name within 1 km) and merges each group into one lead: the one with call history,
// then an audit, then the oldest. Calls and email sequences move to it; the copies are deleted.
// Always run with --dry-run first and read the list.
// Hosted: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, then npm run dedupe

const dry = process.argv.includes("--dry-run");

async function main() {
  const groups = findDuplicates(await loadDupCandidates());
  if (!groups.length) return console.log("No duplicates found.");
  for (const g of groups)
    console.log(`  keep #${g.keep.id} ${g.keep.name}  ←  ${g.drop.map((d) => `#${d.id} ${d.name}`).join(", ")}   (${g.why.join(", ")})`);
  const total = groups.reduce((s, g) => s + g.drop.length, 0);
  if (dry) return console.log(`\nDry run: ${groups.length} businesses have ${total} duplicate lead(s). Nothing changed.`);
  const merged = await mergeDuplicates(groups);
  console.log(`\nMerged ${merged} duplicate lead(s) into ${groups.length}. Kept leads are queued for a fresh audit.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
