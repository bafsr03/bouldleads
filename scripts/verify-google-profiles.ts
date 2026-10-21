import { db } from "../lib/db";
import { GoogleBudgetError, googleFields, placeDetails, remaining } from "../lib/discovery/google-api";
import { phoneKey } from "../lib/discovery/run-search";
import { resolveCategory, similarName } from "../lib/discovery/match";
import { detachProfile, profileMatches, saveProfile, type AuditRow } from "../lib/audit/run-audit";

// Usage: npm run verify-profiles -- [--dry-run] [--search 3] [--limit 300]
// Re-reads every lead's Google profile and checks it's really that business. Before the fix, two
// businesses sharing a phone number could be merged into one lead with the other one's Google link,
// rating and type ("The Max Detail" showing Curby Bro's profile). For each lead:
//   another business's profile → detach it; the next audit matches the lead to its own profile
//   its own profile            → refresh link, rating, reviews and type, and re-check the category
// Changed leads are queued for a fresh audit. One "Profile lookup" per lead (1,000 free a month).
// Hosted: vercel env pull .env.local, then: set -a; source .env.local; set +a; npm run verify-profiles

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : null;
};

async function sharedPhones() {
  const rows = await db.all<{ id: number; name: string; phone: string }>("SELECT id, name, phone FROM businesses WHERE phone IS NOT NULL AND phone != ''");
  const byKey = new Map<string, { id: number; name: string }[]>();
  for (const r of rows) {
    const k = phoneKey(r.phone);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  return [...byKey.values()].filter((g) => g.length > 1 && g.some((a) => g.some((b) => a !== b && !similarName(a.name, b.name))));
}

async function main() {
  const search = opt("--search");
  const limit = opt("--limit") ?? 1000;
  const rows = await db.all<AuditRow & { google_maps_url: string | null }>(
    `SELECT * FROM businesses WHERE google_place_id IS NOT NULL ${search ? "AND search_id = ?" : ""}
     ORDER BY (call_outcome IS NULL) DESC, priority DESC LIMIT ?`,
    ...(search ? [search, limit] : [limit]),
  );
  const budget = await remaining("details_ent");
  console.log(`${rows.length} leads with a Google profile${dry ? " (dry run: nothing is written)" : ""}. Profile lookups left this month: ${budget}.`);
  if (rows.length > budget) console.log(`Only the first ${budget} can be checked this month.`);

  const out = { ok: 0, refreshed: 0, detached: 0, failed: 0 };
  for (const row of rows) {
    let p;
    try {
      p = await placeDetails(row.google_place_id!);
    } catch (e) {
      if (e instanceof GoogleBudgetError) {
        console.log(e.message);
        break;
      }
      out.failed++;
      console.log(`  ! #${row.id} ${row.name}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (!profileMatches(row, p)) {
      out.detached++;
      console.log(`  ✗ #${row.id} ${row.name}: profile is "${p.displayName?.text}" (${p.formattedAddress ?? "?"}). Detached.`);
      if (!dry) {
        await detachProfile(row);
        await db.run("UPDATE businesses SET audit_status = 'queued' WHERE id = ?", row.id);
      }
      continue;
    }
    const g = googleFields(p);
    const before = { url: row.google_maps_url, type: row.google_type, rating: row.rating, reviews: row.review_count, category: row.category };
    // Same check saveProfile applies (a category set by hand is kept).
    const cat = row.category_confirmed === 2 ? null : resolveCategory(row.category, row.name, { primaryType: g.primaryType, primaryTypeLabel: g.type, types: g.types });
    if (!dry) await saveProfile(row, p);
    const changes = [
      before.url !== g.mapsUrl && "profile link",
      before.type !== g.type && `type ${before.type ?? "–"} → ${g.type ?? "–"}`,
      before.rating !== g.rating && `rating ${before.rating ?? "–"} → ${g.rating ?? "–"}`,
      before.reviews !== g.reviewCount && `reviews ${before.reviews ?? "–"} → ${g.reviewCount ?? "–"}`,
      cat && cat.category !== before.category && `category ${before.category} → ${cat.category}`,
      cat && !cat.confirmed && `category "${cat.category}" not confirmed by Google`,
    ].filter(Boolean);
    if (changes.length) {
      out.refreshed++;
      console.log(`  ~ #${row.id} ${row.name}: ${changes.join(", ")}`);
      if (!dry) await db.run("UPDATE businesses SET audit_status = 'queued' WHERE id = ?", row.id);
    } else out.ok++;
  }

  const shared = await sharedPhones();
  if (shared.length) {
    console.log(`\nDifferent businesses sharing one phone number (${shared.length}): call once, check which one answers.`);
    for (const g of shared) console.log(`  ${g.map((b) => `#${b.id} ${b.name}`).join("  |  ")}`);
  }
  console.log(`\nChecked: ${out.ok} fine, ${out.refreshed} refreshed, ${out.detached} had another business's profile, ${out.failed} failed.`);
  if (!dry && out.refreshed + out.detached) console.log("Changed leads are queued for a fresh audit (the background job picks them up).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
