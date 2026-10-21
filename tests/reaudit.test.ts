import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = path.join(process.env.BOULDLEADS_DATA_DIR!, "reaudit");
process.env.BOULDLEADS_DATA_DIR = dir;

let db: typeof import("@/lib/db").db;
let audit: typeof import("@/lib/audit/run-audit");
const DAY = 86_400_000;

beforeAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  db = (await import("@/lib/db")).db;
  audit = await import("@/lib/audit/run-audit");
  await db.run("INSERT INTO searches (id, label, place, area, categories, created_at) VALUES (1, 't', 'Tooele', '{}', '[]', 0)");
  const rows: [number, number, string, string | null][] = [
    [1, 200, "A", null], // stale, best
    [2, 100, "B", null], // stale
    [3, 10, "A", null], // fresh
    [4, 200, "not_fit", null], // stale but not a fit
    [5, 200, "A", "won"], // stale but already a client
  ];
  for (const [id, days, tier, outcome] of rows)
    await db.run(
      `INSERT INTO businesses (id, search_id, source, source_id, name, status, created_at, audit_status, audited_at, tier, priority, call_outcome)
       VALUES (?, 1, 'osm', ?, ?, 'verified', 0, 'done', ?, ?, ?, ?)`,
      id, `n${id}`, `Shop ${id}`, Date.now() - days * DAY, tier, 100 - id, outcome,
    );
});

describe("scheduled re-audits", () => {
  it("picks stale audits of leads still worth calling, best first, a few a day", async () => {
    expect(await audit.staleForReaudit(5)).toEqual([1, 2]);
    // Counted against today's allowance.
    const [, n] = ((await (await import("@/lib/settings")).getSys("reaudit")) ?? "").split(":");
    expect(Number(n)).toBe(2);
  });

  it("keeps the audit's date when only re-scoring", async () => {
    const at = Date.now() - 120 * DAY;
    await db.run(
      `INSERT INTO businesses (id, search_id, source, source_id, name, status, created_at, audit_status, audited_at, audit)
       VALUES (9, 1, 'osm', 'n9', 'Shop 9', 'verified', 0, 'done', ?, ?)`,
      at,
      JSON.stringify({ inputs: { business: {}, site: null, google: { checked: false, found: false }, keywords: [], year: 2026 } }),
    );
    expect(await audit.rescore(9)).not.toBeNull();
    expect((await db.get<{ audited_at: number }>("SELECT audited_at FROM businesses WHERE id = 9"))!.audited_at).toBe(at);
  });
});
