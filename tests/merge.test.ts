import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { DiscoveredBusiness } from "@/lib/discovery/overpass";

// Own throwaway database so it can't collide with other DB tests running in parallel.
const dir = path.join(process.env.BOULDLEADS_DATA_DIR!, "merge");
process.env.BOULDLEADS_DATA_DIR = dir;

let db: typeof import("@/lib/db").db;
let insertBusinesses: typeof import("@/lib/discovery/run-search").insertBusinesses;

const biz = (p: Partial<DiscoveredBusiness>): DiscoveredBusiness => ({
  sourceId: "x",
  name: "X",
  category: "Smoke shops & tobacconists",
  address: null,
  city: "Lima",
  countryCode: "PE",
  lat: -12.1,
  lng: -77.03,
  phone: null,
  website: null,
  email: null,
  ...p,
});

beforeAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  db = (await import("@/lib/db")).db;
  ({ insertBusinesses } = await import("@/lib/discovery/run-search"));
  await db.run("INSERT INTO searches (id, label, area, categories, created_at) VALUES (1, 't', '{}', '[]', 0)");
});

describe("insertBusinesses", () => {
  it("merges the same shop found on OpenStreetMap and Google", async () => {
    expect(await insertBusinesses(1, [biz({ sourceId: "node/1", name: "La Casa del Habano", email: "hola@habano.pe" })], "osm", "PE")).toBe(1);
    const google = biz({
      sourceId: "ChIJ1",
      name: "La Casa del Habano Miraflores",
      lat: -12.1005,
      lng: -77.0302,
      phone: "01 444 5555",
      website: "https://habano.pe/",
      google: { placeId: "ChIJ1", mapsUrl: "https://maps.google.com/?cid=1", type: "Tobacco shop", rating: 4.6, reviewCount: 120, status: "OPERATIONAL" },
    });
    expect(await insertBusinesses(1, [google], "google", "PE")).toBe(0);
    const row = await db.get("SELECT * FROM businesses");
    expect(row).toMatchObject({ email: "hola@habano.pe", phone: "01 444 5555", website: "https://habano.pe/", rating: 4.6, review_count: 120, google_place_id: "ChIJ1" });
  });

  it("keeps different businesses that are close together", async () => {
    expect(await insertBusinesses(1, [biz({ sourceId: "node/2", name: "Vapor Club", lat: -12.1003, lng: -77.0301 })], "osm", "PE")).toBe(1);
  });

  it("skips other locations of a chain sharing a website", async () => {
    await insertBusinesses(1, [biz({ sourceId: "node/3", name: "Smoke Co Centro", website: "https://smokeco.pe/", lat: -12.0 })], "osm", "PE");
    expect(await insertBusinesses(1, [biz({ sourceId: "node/4", name: "Smoke Co Surco", website: "https://smokeco.pe/", lat: -12.2 })], "osm", "PE")).toBe(0);
  });
});

describe("one business, one lead", () => {
  it("merges two Google listings of the same shop by phone number", async () => {
    const a = biz({ sourceId: "ChIJa", name: "La Casita 420 - Smoke Shop", phone: "+51 987 654 321", lat: -12.12, lng: -77.03, website: "https://la-casita-420.kyte.site/" });
    const b = biz({ sourceId: "ChIJb", name: "La Casita 420 Catálogo", phone: "987654321", lat: -12.121, lng: -77.031, website: "https://la-casita-420.catalog.kyte.site/" });
    expect(await insertBusinesses(1, [a], "google", "PE")).toBe(1);
    expect(await insertBusinesses(1, [b], "google", "PE")).toBe(0);
  });

  it("flags chains: the same name 3+ times in a search", async () => {
    const list = [1, 2, 3].map((i) => biz({ sourceId: `node/c${i}`, name: "Tambo+", lat: -12 - i / 10, phone: `01 200 000${i}` }));
    await insertBusinesses(1, list, "osm", "PE");
    expect(await db.count("SELECT COUNT(*) FROM businesses WHERE name = 'Tambo+' AND chain = 1")).toBe(3);
  });

  it("skips public bodies from OpenStreetMap", async () => {
    const { parseElement } = await import("@/lib/discovery/overpass");
    expect(parseElement({ type: "node", id: 1, lat: 0, lon: 0, tags: { name: "Embajada de la India", amenity: "embassy" } })).toBeNull();
    expect(parseElement({ type: "node", id: 2, lat: 0, lon: 0, tags: { name: "Municipalidad", office: "government" } })).toBeNull();
    expect(parseElement({ type: "node", id: 3, lat: 0, lon: 0, tags: { name: "Barbería Don Juan", shop: "hairdresser" } })).not.toBeNull();
  });
});

describe("chains and shared hosts", () => {
  it("flags a chain whose branches share a name root", async () => {
    const list = ["mydentist, Stevenson Square", "mydentist, Didsbury", "mydentist, Ancoats"].map((n, i) =>
      biz({ sourceId: `g/md${i}`, name: n, lat: 53.4 + i / 50, lng: -2.2, phone: `0161 000 00${i}`, website: `https://www.mydentist.co.uk/p${i}` }),
    );
    await insertBusinesses(1, list, "google", "GB");
    expect(await db.count("SELECT COUNT(*) FROM businesses WHERE name LIKE 'mydentist%' AND chain = 1")).toBeGreaterThanOrEqual(1);
  });

  it("keeps two different shops that both link to Linktree", async () => {
    const a = biz({ sourceId: "g/lt1", name: "Humo Verde", lat: -12.3, lng: -77.1, website: "https://linktr.ee/humoverde" });
    const b = biz({ sourceId: "g/lt2", name: "Cogollo Shop", lat: -12.4, lng: -77.2, website: "https://linktr.ee/cogollo" });
    expect(await insertBusinesses(1, [a, b], "google", "PE")).toBe(2);
    expect(await db.count("SELECT COUNT(*) FROM businesses WHERE name IN ('Humo Verde','Cogollo Shop') AND chain = 1")).toBe(0);
  });
});

describe("same phone, different business", () => {
  // The Max Detail and Curby Bro's (same owner, same phone): Curby Bro's Google profile, rating and
  // type used to be merged into The Max Detail's lead.
  it("skips the second business and never mixes its Google profile into the first", async () => {
    const max = biz({
      sourceId: "ChIJmax",
      name: "The Max Detail",
      category: "Car wash & detailing",
      phone: "(435) 375-6904",
      lat: 40.6,
      lng: -112.46,
      google: { placeId: "ChIJmax", mapsUrl: "https://maps.google.com/?cid=111", type: "Car wash", rating: 4.1, reviewCount: 9, status: "OPERATIONAL" },
    });
    const curby = biz({
      sourceId: "ChIJcurby",
      name: "Curby Bro's",
      category: "Landscaping & gardening",
      phone: "435-375-6904",
      lat: 40.601,
      lng: -112.462,
      google: { placeId: "ChIJcurby", mapsUrl: "https://maps.google.com/?cid=222", type: "General Contractor", rating: 5, reviewCount: 62, status: "OPERATIONAL" },
    });
    expect(await insertBusinesses(1, [max], "google", "US")).toBe(1);
    expect(await insertBusinesses(1, [curby], "google", "US")).toBe(0);
    const row = await db.get("SELECT * FROM businesses WHERE source_id = 'ChIJmax'");
    expect(row).toMatchObject({ google_place_id: "ChIJmax", google_maps_url: "https://maps.google.com/?cid=111", google_type: "Car wash", rating: 4.1, review_count: 9 });
  });

  it("never overwrites another listing's Google data when merging by name", async () => {
    const a = biz({
      sourceId: "ChIJp1",
      name: "Pete's Auto Repair",
      lat: 40.53,
      lng: -112.3,
      google: { placeId: "ChIJp1", mapsUrl: "https://maps.google.com/?cid=1", type: "Auto repair shop", rating: 4.2, reviewCount: 67, status: "OPERATIONAL" },
    });
    const b = biz({
      sourceId: "ChIJp2",
      name: "Pete's Auto Repair",
      lat: 40.5301,
      lng: -112.3001,
      google: { placeId: "ChIJp2", mapsUrl: "https://maps.google.com/?cid=2", type: "Tire shop", rating: 3.0, reviewCount: 2, status: "OPERATIONAL" },
    });
    await insertBusinesses(1, [a], "google", "US");
    await insertBusinesses(1, [b], "google", "US");
    expect(await db.get("SELECT google_maps_url, rating, review_count FROM businesses WHERE source_id = 'ChIJp1'")).toMatchObject({
      google_maps_url: "https://maps.google.com/?cid=1",
      rating: 4.2,
      review_count: 67,
    });
  });

  it("stores whether Google confirmed the category", async () => {
    await insertBusinesses(1, [biz({ sourceId: "ChIJhy", name: "Hy & Mike's Tooele", category: "Motorcycles & powersports", categoryConfirmed: false, lat: 40.54, lng: -112.29 })], "google", "US");
    await insertBusinesses(1, [biz({ sourceId: "node/osm1", name: "Some Shop", lat: 41, lng: -112 })], "osm", "US");
    expect(await db.get("SELECT category_confirmed FROM businesses WHERE source_id = 'ChIJhy'")).toMatchObject({ category_confirmed: 0 });
    expect(await db.get("SELECT category_confirmed FROM businesses WHERE source_id = 'node/osm1'")).toMatchObject({ category_confirmed: 1 });
  });
});
