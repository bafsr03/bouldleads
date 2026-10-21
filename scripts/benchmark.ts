import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";

// Real-world check of lead finding + the audit. Runs live searches and audits into a throwaway database
// (never your real one) and prints what came back, so the results can be checked by hand.
//
//   BOULDLEADS_DATA_DIR=/tmp/bench GOOGLE_PLACES_API_KEY=… npx tsx scripts/benchmark.ts [maxPerNiche]
//
// Uses a few dozen Google requests (well inside the free monthly allowance).

const NICHES: { label: string; place: string; types: string[] }[] = [
  { label: "Roofing contractors · Austin TX", place: "Austin, Texas", types: ["roofer"] },
  { label: "Dentists · Manchester UK", place: "Manchester, England", types: ["dentist"] },
  { label: "Smoke shops · Lima PE", place: "Lima, Peru", types: ["smoke_shop"] },
];

async function main() {
  if (!process.env.BOULDLEADS_DATA_DIR || process.env.BOULDLEADS_DATA_DIR.endsWith("/data")) throw new Error("Set BOULDLEADS_DATA_DIR to a scratch folder.");
  const max = Number(process.argv[2] ?? 25);
  const { db, now } = await import("../lib/db");
  const { geocode } = await import("../lib/discovery/nominatim");
  const { runSearch } = await import("../lib/discovery/run-search");
  const { auditOne } = await import("../lib/audit/run-audit");
  const { describeSelection } = await import("../lib/discovery/categories");

  const report: unknown[] = [];
  for (const n of NICHES) {
    const [p] = await geocode(n.place);
    const area = { type: "place" as const, label: p.label, bbox: p.bbox, areaId: p.areaId };
    const parts = p.label.split(",").map((x) => x.trim());
    const r = await db.run(
      `INSERT INTO searches (label, place, source, area, categories, country_code, require_website, max_results, created_at)
       VALUES (?, ?, 'google', ?, ?, ?, 2, ?, ?)`,
      `${describeSelection(n.types)} · ${parts[0]}`,
      `${parts[0]}, ${parts[parts.length - 1]}`,
      JSON.stringify(area),
      JSON.stringify(n.types),
      p.countryCode,
      max,
      now(),
    );
    const t0 = Date.now();
    await runSearch(r.lastId);
    const ids = (await db.all<{ id: number }>("SELECT id FROM businesses WHERE search_id = ?", r.lastId)).map((x) => x.id);
    const limit = pLimit(6);
    await Promise.all(ids.map((id) => limit(() => auditOne(id))));
    const rows = await db.all<Record<string, unknown> & { audit: string }>(
      "SELECT id, name, phone, website, rating, review_count, tier, priority, chain, audit FROM businesses WHERE search_id = ? ORDER BY priority DESC",
      r.lastId,
    );
    const leads = rows.map((x) => {
      const a = JSON.parse(x.audit);
      return {
        name: x.name,
        phone: x.phone,
        website: x.website,
        rating: x.rating,
        reviews: x.review_count,
        tier: x.tier,
        priority: x.priority,
        chain: !!x.chain,
        pattern: a.pattern.label,
        visibility: `${a.visibility.score}/20 (${a.visibility.open} open)`,
        conversion: a.conversion.measured ? a.conversion.score : a.conversion.note,
        rank: a.inputs.google.rank,
        rankQuery: a.inputs.google.rankQuery,
        deep: a.inputs.google.deep,
        pageSpeed: a.inputs.site?.pageSpeed ?? null,
        contactPage: a.inputs.site?.contactPage ?? null,
        findings: a.findings.map((f: { say: string }) => f.say),
      };
    });
    const count = (f: (l: (typeof leads)[number]) => boolean) => leads.filter(f).length;
    console.log(`\n=== ${n.label}: ${leads.length} leads in ${Math.round((Date.now() - t0) / 1000)} s`);
    console.log(
      `with website ${count((l) => !!l.website)} · without ${count((l) => !l.website)} · tier A ${count((l) => l.tier === "A")} · B ${count((l) => l.tier === "B")} · C ${count((l) => l.tier === "C")} · not fit ${count((l) => l.tier === "not_fit")} · chains ${count((l) => l.chain)} · deep-audited ${count((l) => !!l.deep)}`,
    );
    for (const l of leads.slice(0, 10))
      console.log(
        `  ${String(l.priority).padStart(3)} ${String(l.tier).padEnd(7)} ${String(l.name).slice(0, 34).padEnd(34)} ★${l.rating ?? "-"} (${l.reviews ?? 0}) rank ${l.rank ?? "-"} · ${l.pattern} · ${l.findings[0] ?? ""}`.slice(0, 220),
      );
    report.push({ niche: n.label, leads });
  }
  const out = path.join(process.env.BOULDLEADS_DATA_DIR!, "benchmark.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nFull results: ${out}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
