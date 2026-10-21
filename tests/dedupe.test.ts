import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findDuplicates, type DupLead } from "@/lib/dedupe";

const dir = path.join(process.env.BOULDLEADS_DATA_DIR!, "dedupe");
process.env.BOULDLEADS_DATA_DIR = dir;

const L = (p: Partial<DupLead> & { id: number; name: string }): DupLead => ({
  phone: null, domain: null, google_place_id: null, lat: 40.53, lng: -112.3, call_attempts: 0, audit: null, chain: 0, ...p,
});

describe("findDuplicates", () => {
  it("catches the duplicates from the audit brief", () => {
    const groups = findDuplicates([
      L({ id: 1, name: "Ross Automotive", phone: "(435) 884-3390" }),
      L({ id: 2, name: "Ross Automotive Inc", phone: "+14358843390", call_attempts: 2 }),
      L({ id: 209, name: "Romaine Electric", lat: 40.7, lng: -111.9 }),
      L({ id: 228, name: "Romaine Electric/Intermountain Electric", lat: 40.703, lng: -111.905 }),
      L({ id: 30, name: "Carrillo Brother's Auto Repair", google_place_id: "abc" }),
      L({ id: 31, name: "Carrillo Brother's Towing", google_place_id: "abc" }),
    ]);
    expect(groups.map((g) => [g.keep.id, g.drop.map((d) => d.id).sort()])).toEqual([
      [2, [1]], // the one with call history is kept
      [209, [228]],
      [30, [31]],
    ]);
    expect(groups[0].why).toEqual(["same phone"]);
  });

  it("keeps different businesses apart", () => {
    expect(
      findDuplicates([
        // One owner, two companies, one phone.
        L({ id: 1, name: "The Max Detail", phone: "(435) 375-6904" }),
        L({ id: 2, name: "Curby Bro's", phone: "(435) 375-6904" }),
        // Same generic start, different shops.
        L({ id: 3, name: "Tooele Auto Repair" }),
        L({ id: 4, name: "Tooele Auto Body" }),
        // Same name, far apart (another town).
        L({ id: 5, name: "Gross Family Plumbing", lat: 40.5, lng: -112.3 }),
        L({ id: 6, name: "Gross Family Plumbing", lat: 41.2, lng: -111.9 }),
        // Chain locations share a website.
        L({ id: 7, name: "Esab Welding", domain: "esab.com", chain: 1 }),
        L({ id: 8, name: "Esab Welding", domain: "esab.com", chain: 1, lat: 40.6 }),
      ]),
    ).toEqual([]);
  });
});

describe("mergeDuplicates", () => {
  let db: typeof import("@/lib/db").db;
  beforeAll(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    db = (await import("@/lib/db")).db;
    await db.run("INSERT INTO searches (id, label, place, area, categories, created_at) VALUES (1, 't', 'Tooele', '{}', '[]', 0)");
  });

  it("moves calls over, fills gaps and deletes the copy", async () => {
    const { loadDupCandidates, mergeDuplicates } = await import("@/lib/dedupe");
    await db.run(
      `INSERT INTO businesses (id, search_id, source, source_id, name, phone, website, status, lat, lng, created_at, call_attempts, call_outcome, ask_for)
       VALUES (1, 1, 'google', 'p1', 'Ross Automotive', '(435) 884-3390', NULL, 'no_website', 40.5, -112.3, 0, 2, 'call_back', NULL),
              (2, 1, 'google', 'p2', 'Ross Automotive Inc', '(435) 884-3390', 'https://rossauto.com/', 'pending', 40.5, -112.3, 0, 1, 'no_answer', 'Dave')`,
    );
    await db.run("INSERT INTO calls (business_id, outcome, created_at) VALUES (1, 'call_back', 1), (2, 'no_answer', 2), (1, 'no_answer', 3)");
    const groups = findDuplicates(await loadDupCandidates());
    expect(groups).toHaveLength(1);
    expect(await mergeDuplicates(groups)).toBe(1);
    const b = await db.get<Record<string, unknown>>("SELECT id, website, ask_for, call_attempts, call_outcome FROM businesses");
    expect(b).toEqual({ id: 1, website: "https://rossauto.com/", ask_for: "Dave", call_attempts: 3, call_outcome: "call_back" });
    expect(await db.count("SELECT COUNT(*) FROM calls WHERE business_id = 1")).toBe(3);
    expect(await db.count("SELECT COUNT(*) FROM businesses")).toBe(1);
  });
});
