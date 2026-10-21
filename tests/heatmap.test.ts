import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Own throwaway databases so they can't collide with other DB tests running in parallel.
const dir = path.join(process.env.BOULDLEADS_DATA_DIR!, "heatmap");
process.env.BOULDLEADS_DATA_DIR = dir;

let db: typeof import("@/lib/db").db;
let heatmapData: typeof import("@/lib/heatmap").heatmapData;

beforeAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  ({ db } = await import("@/lib/db"));
  ({ heatmapData } = await import("@/lib/heatmap"));
  await db.batch([
    ["INSERT INTO searches (id, label, place, area, categories, created_at) VALUES (1, 'a', 'Lima, Peru', '{}', '[]', 0)"],
    ["INSERT INTO searches (id, label, place, area, categories, created_at) VALUES (2, 'b', 'Austin, United States', '{}', '[]', 0)"],
    ["INSERT INTO businesses (id, search_id, source, source_id, name, country_code, lat, lng, phone, tier, status, created_at) VALUES (1, 1, 'osm', 'n1', 'A', 'PE', -12.1, -77.0, '1', 'A', 'verified', ?)", Date.now()],
    ["INSERT INTO businesses (id, search_id, source, source_id, name, country_code, lat, lng, phone, tier, status, call_outcome, created_at) VALUES (2, 1, 'osm', 'n2', 'B', 'PE', -12.3, -77.2, '2', 'C', 'verified', 'audit_booked', 0)"],
    ["INSERT INTO businesses (id, search_id, source, source_id, name, country_code, lat, lng, phone, status, created_at) VALUES (3, 2, 'osm', 'n3', 'C', 'US', 30.2, -97.7, '3', 'no_email', 0)"],
    ["INSERT INTO calls (business_id, outcome, created_at) VALUES (2, 'no_answer', ?)", Date.now() - 1000],
    ["INSERT INTO calls (business_id, outcome, created_at) VALUES (2, 'audit_booked', ?)", Date.now()],
  ]);
});

describe("heat map data", () => {
  it("totals leads per country and per place, with the place at its leads' centroid", async () => {
    const d = await heatmapData("UTC");
    expect(d.countries.find((c) => c.cc === "PE")).toMatchObject({ leads: 2, good: 1, called: 1, booked: 1 });
    expect(d.countries.find((c) => c.cc === "US")).toMatchObject({ leads: 1, good: 0 });
    const lima = d.places.find((p) => p.place === "Lima, Peru")!;
    expect(lima.leads).toBe(2);
    expect(lima.lat).toBeCloseTo(-12.2);
    expect(lima.lng).toBeCloseTo(-77.1);
  });

  it("encodes every lead as a compact point: lat, lng, tier, stage, id", async () => {
    const d = await heatmapData("UTC");
    expect(d.points).toContainEqual([-12.1, -77, 1, 0, 1]); // tier A, stage "To call"
    expect(d.points).toContainEqual([-12.3, -77.2, 3, 5, 2]); // tier C, stage "Booked & won"
    expect(d.points).toContainEqual([30.2, -97.7, 0, 0, 3]); // not audited
  });

  it("counts today's calls and the answer rate", async () => {
    const d = await heatmapData("UTC");
    expect(d.days).toHaveLength(14);
    expect(d.kpis).toMatchObject({ callsToday: 2, dials: 2, answerRate: 0.5, booked: 1, leads: 3 });
  });
});

describe("copy to hosted", () => {
  it("copies leads and history, skips secrets and inboxes, and won't overwrite without --force", async () => {
    const { openClient, localDbUrl } = await import("@/lib/db");
    const { copyDatabase } = await import("@/lib/copy-db");
    await db.batch([
      ["INSERT INTO settings (key, value) VALUES ('companyName', '\"Bould\"'), ('secret:googlePlacesApiKey', 'enc'), ('sys:tickLock', 'x')"],
      ["INSERT INTO inboxes (id, label, from_name, email, smtp_host, smtp_port, smtp_secure, username, password_enc, warmup_start, created_at) VALUES (1, 'a', 'A', 'a@x.test', 'h', 1, 0, 'u', 'enc', 0, 0)"],
      ["INSERT INTO campaigns (id, name, steps, inbox_ids, lead_filter, kind, created_at) VALUES (1, 'No-answer follow-up', '[]', '[1]', '{}', 'followup', 0)"],
    ]);
    const target = path.join(dir, "hosted");
    fs.mkdirSync(target, { recursive: true });
    const dst = await openClient(`file:${path.join(target, "copy.db")}`);
    const src = await openClient(localDbUrl());
    const report = await copyDatabase(src, dst);
    expect(report.find((r) => r.table === "businesses")?.rows).toBe(3);
    const one = async (sql: string) => (await dst.execute(sql)).rows[0];
    expect(Number((await one("SELECT COUNT(*) AS n FROM calls")).n)).toBe(2);
    expect((await one("SELECT place FROM searches WHERE id = 1")).place).toBe("Lima, Peru");
    expect(Number((await one("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'secret:%' OR key LIKE 'sys:%'")).n)).toBe(0);
    expect(Number((await one("SELECT COUNT(*) AS n FROM inboxes")).n)).toBe(0);
    expect((await one("SELECT inbox_ids, kind FROM campaigns WHERE id = 1")).inbox_ids).toBe("[]");
    await expect(copyDatabase(src, dst)).rejects.toThrow(/--force/);
    await expect(copyDatabase(src, dst, { force: true })).resolves.toBeTruthy();
  });
});
