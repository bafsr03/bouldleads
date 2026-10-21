import { describe, expect, it } from "vitest";
import {
  BUSINESS_TYPES,
  GROUPS,
  describeSelection,
  googleTermsFor,
  isValidToken,
  labelForTags,
  osmFiltersFor,
} from "@/lib/discovery/categories";

describe("catalog", () => {
  it("has unique ids and every type belongs to a known group", () => {
    const ids = BUSINESS_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set<string>(GROUPS.map((g) => g.id));
    BUSINESS_TYPES.forEach((t) => expect(groups.has(t.group)).toBe(true));
    expect(BUSINESS_TYPES.length).toBeGreaterThan(100);
  });
});

describe("selection tokens", () => {
  it("validates types, groups, all, keywords, tags and legacy ids", () => {
    for (const ok of ["smoke_shop", "group:smoke", "all", "kw:barber", "tag:shop=tobacco", "tag:craft", "food"]) expect(isValidToken(ok)).toBe(true);
    for (const bad of ["nope", "group:nope", "kw:x", 'tag:shop="x', "tag:=x", "tag:shop=a]b"]) expect(isValidToken(bad)).toBe(false);
  });

  it("builds smoke shop filters from tags plus name keywords", () => {
    const f = osmFiltersFor(["smoke_shop"]);
    expect(f).toContain('["shop"~"^(tobacco|headshop|smoke_shop|smoking)$"]');
    expect(f).toContain('["shop"]["name"~"smoke|tobacco|cigar|head shop|tabac|tabaq|fumador|habano|grow shop|growshop|tabak",i]');
  });

  it("expands groups and dedupes", () => {
    const f = osmFiltersFor(["group:smoke", "smoke_shop"]);
    expect(f.filter((x) => x.includes("tobacco|headshop")).length).toBe(1);
    expect(f.some((x) => x.includes("e-cigarette"))).toBe(true);
  });

  it("escapes custom keywords and builds per-key name filters", () => {
    const f = osmFiltersFor(['kw:Joe"s (BBQ)']);
    expect(f).toContain('["shop"]["name"~"Joe\\"s \\\\(BBQ\\\\)",i]');
    expect(f).toHaveLength(7);
  });

  it("supports raw tags and 'all'", () => {
    expect(osmFiltersFor(["tag:shop=bakery"])).toEqual(['["shop"~"^(bakery)$"]']);
    expect(osmFiltersFor(["tag:craft"])).toEqual(['["craft"]["craft"!~"^(no|vacant)$"]']);
    const all = osmFiltersFor(["all"]);
    expect(all).toContain('["shop"]["shop"!~"^(no|vacant)$"]');
    expect(all.some((x) => x.includes('"amenity"~"^(restaurant)$"'))).toBe(true);
    expect(all.every((x) => !x.includes('"name"'))).toBe(true);
  });

  it("maps legacy ids to groups and builds Google terms", () => {
    expect(osmFiltersFor(["food"]).length).toBeGreaterThan(5);
    expect(googleTermsFor(["smoke_shop", "kw:hookah bar", "tag:shop=e-cigarette"])).toEqual(["smoke shop", "tobacco shop", "hookah bar", "e cigarette"]);
    expect(describeSelection(["group:smoke", "kw:vape", "all"])).toBe("Smoke, vape & CBD, name contains “vape”, All businesses");
  });
});

describe("labelForTags", () => {
  it("labels by tag, preferring specific keys", () => {
    expect(labelForTags({ name: "X", shop: "tobacco" })).toBe("Smoke shops & tobacconists");
    expect(labelForTags({ name: "Polished", shop: "beauty", beauty: "nails" })).toBe("Nail salons");
  });
  it("refines by name only within the same industry", () => {
    expect(labelForTags({ name: "Classic Barber Co", shop: "hairdresser" })).toBe("Barbershops");
    expect(labelForTags({ name: "Smoke BBQ", amenity: "restaurant" })).toBe("Restaurants");
    expect(labelForTags({ name: "Cloud 9 Smoke & Vape", shop: "yes" })).toBe("Smoke shops & tobacconists");
  });
  it("falls back to the raw value or 'Other business'", () => {
    expect(labelForTags({ name: "X", shop: "kayak_rental" })).toBe("Kayak rental");
    expect(labelForTags({ name: "X", office: "yes" })).toBe("Other business");
  });
});

describe("local-language search", () => {
  it("adds the country's own term after the English ones, filed under the searched type", async () => {
    const { googleQueriesFor } = await import("@/lib/discovery/categories");
    const pe = googleQueriesFor(["smoke_shop"], "PE");
    expect(pe[0]).toEqual({ text: "smoke shop", lang: null, type: "Smoke shops & tobacconists" });
    expect(pe.at(-1)).toEqual({ text: "tabaquería", lang: "es", type: "Smoke shops & tobacconists" });
    expect(pe.filter((q) => q.lang === null).length).toBe(googleQueriesFor(["smoke_shop"], "US").length);
    expect(googleQueriesFor(["roofer"], "US").every((q) => q.lang === null)).toBe(true);
    expect(googleQueriesFor(["dentist"], "BR").at(-1)).toEqual({ text: "dentista", lang: "pt", type: "Dentists & orthodontists" });
    expect(googleQueriesFor(["kw:hookah"], "MX")).toEqual([{ text: "hookah", lang: null, type: null }]);
  });

  it("covers every catalog type in every language", async () => {
    const { BUSINESS_TYPES } = await import("@/lib/discovery/categories");
    const { localTerm } = await import("@/lib/discovery/local-terms");
    const missing = BUSINESS_TYPES.flatMap((t) => (["es", "pt", "fr", "de", "it", "nl"] as const).filter((l) => !localTerm(t.id, l)).map((l) => `${t.id}:${l}`));
    expect(missing).toEqual([]);
  });
});

describe("resolveCategory", () => {
  it("doesn't trust the search term alone: a pawn shop found by 'motorcycle dealer'", async () => {
    const { resolveCategory } = await import("@/lib/discovery/match");
    expect(resolveCategory("Motorcycles & powersports", "Hy & Mike's Tooele", { primaryType: "store", primaryTypeLabel: "Services", types: ["store", "point_of_interest", "establishment"] })).toEqual({
      category: "Motorcycles & powersports",
      confirmed: false,
    });
  });

  it("confirms by Google type or by name", async () => {
    const { resolveCategory } = await import("@/lib/discovery/match");
    expect(resolveCategory("Car wash & detailing", "One Way", { primaryType: "car_wash", primaryTypeLabel: "Car wash", types: ["car_wash"] }).confirmed).toBe(true);
    expect(resolveCategory("Car wash & detailing", "The Max Detail", { types: ["point_of_interest"] })).toEqual({ category: "Car wash & detailing", confirmed: true });
    expect(resolveCategory("Motorcycles & powersports", "Tooele Powersports", {}).confirmed).toBe(true);
    // "Bicycle" must not confirm a motorcycle search
    expect(resolveCategory("Motorcycles & powersports", "Tooele Bicycle Co", {}).confirmed).toBe(false);
  });

  it("relabels when Google says it's another catalog type", async () => {
    const { resolveCategory } = await import("@/lib/discovery/match");
    expect(resolveCategory("Motorcycles & powersports", "Main Street Treasures", { primaryType: "thrift_store", primaryTypeLabel: "Thrift store", types: ["thrift_store"] })).toEqual({
      category: "Thrift, antiques & pawn",
      confirmed: true,
    });
    expect(resolveCategory("Car wash & detailing", "Curby Bro's", { primaryType: "general_contractor", primaryTypeLabel: "General Contractor", types: ["general_contractor"] })).toEqual({
      category: "Builders & contractors",
      confirmed: true,
    });
  });

  it("uses Google's own label for types we don't catalog", async () => {
    const { resolveCategory } = await import("@/lib/discovery/match");
    expect(resolveCategory("Motorcycles & powersports", "Hy & Mike's", { primaryType: "gas_station", primaryTypeLabel: "Gas station", types: ["gas_station"] })).toEqual({
      category: "Gas station",
      confirmed: true,
    });
  });
});
