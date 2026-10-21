import { describe, expect, it } from "vitest";
import { areaBbox, buildQuery, normalizeWebsite, parseElement, quarter, splitBbox } from "@/lib/discovery/overpass";

describe("tiling", () => {
  it("covers the bbox exactly with tiles no larger than the tile size", () => {
    const tiles = splitBbox([40, -4, 41, -3], 0.25);
    expect(tiles).toHaveLength(16);
    expect(tiles[0]).toEqual([40, -4, 40.25, -3.75]);
    expect(tiles.at(-1)).toEqual([40.75, -3.25, 41, -3]);
  });

  it("returns a single tile for small areas and quarters correctly", () => {
    expect(splitBbox([1, 1, 1.1, 1.1])).toHaveLength(1);
    expect(quarter([0, 0, 2, 2])).toEqual([
      [0, 0, 1, 1],
      [0, 1, 1, 2],
      [1, 0, 2, 1],
      [1, 1, 2, 2],
    ]);
  });

  it("computes a circle's bbox", () => {
    const [s, w, n, e] = areaBbox({ type: "circle", lat: 0, lng: 0, radiusKm: 111.32 });
    expect(n - s).toBeCloseTo(2, 3);
    expect(e - w).toBeCloseTo(2, 3);
  });
});

describe("buildQuery", () => {
  it("combines category filters, contact requirement and area scope", () => {
    const q = buildQuery({ type: "place", label: "X", bbox: [0, 0, 1, 1], areaId: 3600000123 }, [0, 0, 1, 1], ["car_repair"], 1);
    expect(q).toContain('nwr["shop"~"^(car_repair)$"]["name"]');
    expect(q).toContain("(area:3600000123)(0,0,1,1);");
    expect(q).toContain('[~"^(website|contact:website|url|email|contact:email)$"~"."]');
    expect(q).toContain("out tags center;");
  });

  it("uses an around filter for circles", () => {
    const q = buildQuery({ type: "circle", lat: 30.1, lng: -97.7, radiusKm: 5 }, [0, 0, 1, 1], ["restaurant"], 0);
    expect(q).toContain("(around:5000,30.1,-97.7)");
  });
});

describe("parseElement", () => {
  it("maps OSM tags to a business", () => {
    const b = parseElement({
      type: "way",
      id: 42,
      center: { lat: 1, lon: 2 },
      tags: {
        name: "Bright Smiles",
        amenity: "dentist",
        "addr:housenumber": "12",
        "addr:street": "Main St",
        "addr:city": "Austin",
        "contact:website": "brightsmiles.com",
        email: "Info@BrightSmiles.com; other@x.com",
      },
    });
    expect(b).toMatchObject({
      sourceId: "way/42",
      name: "Bright Smiles",
      category: "Dentists & orthodontists",
      address: "12 Main St, Austin",
      city: "Austin",
      lat: 1,
      lng: 2,
      website: "https://brightsmiles.com/",
      email: "info@brightsmiles.com",
    });
  });

  it("skips unnamed elements and social-only websites", () => {
    expect(parseElement({ type: "node", id: 1, tags: { shop: "bakery" } })).toBeNull();
    expect(normalizeWebsite("https://www.facebook.com/joesbakery")).toBeNull();
    expect(normalizeWebsite("joes.com")).toBe("https://joes.com/");
  });
});

describe("chains", () => {
  it("skips branded chain locations", () => {
    expect(parseElement({ type: "node", id: 2, tags: { name: "Starbucks", amenity: "cafe", "brand:wikidata": "Q37158" } })).toBeNull();
  });
});

describe("websites that only look like social links", () => {
  it("keeps domains that merely end in x.com or tiktok.com", async () => {
    const { normalizeWebsite } = await import("@/lib/discovery/overpass");
    expect(normalizeWebsite("https://clearchoiceroofingatx.com/?utm_source=gbp")).toBe("https://clearchoiceroofingatx.com/?utm_source=gbp");
    expect(normalizeWebsite("qualityexteriorsatx.com")).toBe("https://qualityexteriorsatx.com/");
    expect(normalizeWebsite("https://www.x.com/joesroofing")).toBeNull();
    expect(normalizeWebsite("https://m.facebook.com/joes")).toBeNull();
  });
  it("doesn't count links to such sites as an X profile", async () => {
    const { analyzeHtml } = await import("@/lib/audit/site");
    expect(analyzeHtml(`<a href="https://clearchoiceroofingatx.com/about">About</a>`, "https://clearchoiceroofingatx.com/").profiles).not.toContain("X / Twitter");
    expect(analyzeHtml(`<a href="https://x.com/joesroofing">X</a>`, "https://joes.example/").profiles).toContain("X / Twitter");
  });
});
