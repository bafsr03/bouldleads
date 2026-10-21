import pLimit from "p-limit";
import { db } from "../lib/db";
import { checkSite, type SiteFacts } from "../lib/audit/site";
import { rescore, type AuditRow } from "../lib/audit/run-audit";
import { CHAIN_BY_NAME_SQL } from "../lib/discovery/run-search";
import { chainReason, formatPhone } from "../lib/discovery/fit";
import { findSite } from "../lib/audit/find-site";
import { normalizeWebsite, socialUrl } from "../lib/discovery/overpass";

// Usage: npm run recheck -- [--dry-run] [--no-sites]
// Applies the Oct 2026 data fixes to leads that are already in the database. Run verify-profiles first.
//   1. One phone format: "(435) 884-3390"
//   2. Facebook / Instagram / Yelp / directory pages kept as "social only", not as their website
//   3. Chains: the same name at 3+ locations anywhere in the database
//   4. Websites that were "down", "blocked" or social are checked again with the new rules
//      (every address variant; "couldn't check" vs. really down). Free: no Google calls.
//   5. Google-listed leads with no website: look for a site they never linked (free; --no-find skips)
//   6. Every audited lead re-scored from its stored research (chains, non-fits, pitch type, new priority)
// Prints the top 30 by priority before and after.
// Hosted: vercel env pull .env.local, then: set -a; source .env.local; set +a; npm run recheck

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const sites = !args.includes("--no-sites");
const find = !args.includes("--no-find");

const kind = (x: SiteFacts | null | undefined) =>
  !x ? "not checked" : x.socialOnly ? "social" : x.directory ? "directory" : x.error === "blocked" || x.error === "script" ? "couldn't check" : (x.error ?? "ok");

type Row = AuditRow & { audit: string | null; priority: number | null; tier: string | null };

const top = async () =>
  db.all<{ id: number; name: string; priority: number | null; tier: string | null }>(
    "SELECT id, name, priority, tier FROM businesses WHERE audit IS NOT NULL ORDER BY priority DESC, id DESC LIMIT 30",
  );

async function main() {
  const before = await top();
  const out = { phones: 0, social: 0, chains: 0, sites: 0, siteChanged: 0, found: 0, possible: 0, rescored: 0 };

  // 1 + 2: phones and social links
  const rows = await db.all<{ id: number; phone: string | null; website: string | null; country_code: string | null; social_url: string | null }>(
    "SELECT id, phone, website, country_code, social_url FROM businesses",
  );
  for (const r of rows) {
    const phone = formatPhone(r.phone, r.country_code);
    if (phone !== r.phone) {
      out.phones++;
      if (!dry) await db.run("UPDATE businesses SET phone = ? WHERE id = ?", phone, r.id);
    }
    const social = r.website && !normalizeWebsite(r.website) ? socialUrl(r.website) : null;
    if (social) {
      out.social++;
      console.log(`  social  #${r.id}: ${r.website} is a social/listing page, not their website`);
      if (!dry) await db.run("UPDATE businesses SET social_url = COALESCE(social_url, ?), website = NULL, domain = NULL WHERE id = ?", social, r.id);
    }
  }

  // 3: chains across the whole database
  if (!dry) out.chains = (await db.run(CHAIN_BY_NAME_SQL)).changes;

  // 4: re-check websites the old rules called down / blocked / social
  const fresh = new Map<number, SiteFacts | null>();
  if (sites) {
    const audited = await db.all<Row>("SELECT * FROM businesses WHERE audit IS NOT NULL AND website IS NOT NULL");
    const todo = audited.filter((r) => {
      const s = (JSON.parse(r.audit!) as { inputs?: { site?: SiteFacts | null } }).inputs?.site;
      return !s || s.error || s.socialOnly || !s.reachable;
    });
    console.log(`\nRe-checking ${todo.length} websites the old check couldn't read or called down…`);
    const limit = pLimit(6);
    await Promise.all(
      todo.map((r) =>
        limit(async () => {
          const old = (JSON.parse(r.audit!) as { inputs?: { site?: SiteFacts | null } }).inputs?.site;
          try {
            const s = await checkSite(r.website!, { pageSpeed: false });
            out.sites++;
            fresh.set(r.id, s);
            if (kind(old) !== kind(s)) {
              out.siteChanged++;
              console.log(`  site    #${r.id} ${r.name}: ${kind(old)} → ${kind(s)}${s.cause ? ` (${s.cause})` : ""}  ${r.website}`);
            }
          } catch (e) {
            console.log(`  !       #${r.id} ${r.name}: ${e instanceof Error ? e.message : e}`);
          }
        }),
      ),
    );
  }

  // 5: sites Google doesn't link
  if (find) {
    const todo = await db.all<Row>(
      "SELECT * FROM businesses WHERE google_place_id IS NOT NULL AND website IS NULL AND social_url IS NULL AND site_search_at IS NULL AND chain = 0",
    );
    console.log(`\nLooking for unlinked websites for ${todo.length} leads with no site on Google…`);
    const limit = pLimit(6);
    await Promise.all(
      todo.map((r) =>
        limit(async () => {
          if (chainReason(r)) return;
          const f = await findSite({ name: r.name, city: r.city, phone: r.phone }).catch(() => null);
          if (f) {
            console.log(`  found   #${r.id} ${r.name}: ${f.url} (${f.how === "possible" ? "maybe theirs" : `confirmed by ${f.how}`})`);
            if (f.how === "possible") out.possible++;
            else {
              out.found++;
              fresh.set(r.id, await checkSite(f.url, { pageSpeed: false }).catch(() => null));
            }
          }
          if (!dry) await db.run("UPDATE businesses SET found_site = ?, found_site_how = ?, site_search_at = ? WHERE id = ?", f?.url ?? null, f?.how ?? null, Date.now(), r.id);
        }),
      ),
    );
  }

  // 6: re-score everyone from stored research
  if (!dry) {
    const ids = await db.all<{ id: number }>("SELECT id FROM businesses WHERE audit IS NOT NULL");
    for (const { id } of ids) {
      const site = fresh.get(id);
      if (await rescore(id, site !== undefined ? { site } : {})) out.rescored++;
    }
  }

  const after = await top();
  const rank = (list: { id: number }[], id: number) => list.findIndex((x) => x.id === id) + 1;
  console.log("\nTop 30 by priority:");
  console.log("  now                                         was");
  for (const [i, r] of after.entries()) {
    const was = rank(before, r.id);
    const b = before.find((x) => x.id === r.id);
    console.log(`  ${String(i + 1).padStart(2)}. ${`${r.name} (${r.priority}, ${r.tier})`.padEnd(42).slice(0, 42)}  ${was ? `#${was} (${b!.priority})` : "new in top 30"}`);
  }
  const dropped = before.filter((b) => !after.some((a) => a.id === b.id));
  if (dropped.length) console.log(`\nLeft the top 30: ${dropped.map((d) => `${d.name} (${d.priority})`).join(", ")}`);
  console.log(
    `\n${dry ? "Dry run: nothing written. " : ""}Phones reformatted ${out.phones}, social links kept ${out.social}, chains flagged ${out.chains}, websites re-checked ${out.sites} (${out.siteChanged} changed), unlinked sites found ${out.found} (+${out.possible} maybe), re-scored ${out.rescored}.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
