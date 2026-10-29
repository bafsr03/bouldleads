import { describe, expect, it } from "vitest";
import { SKIP, callPriority, diagnose, makeSlug, rankOf, reviewGap, serviceOf, skipReason, topCategory, type Competitor, type LeadFacts, type SiteFlags } from "@/lib/check/diagnose";

const c = (id: string, name: string, rating: number | null, reviews: number | null, primaryType = "web_designer", category = "Website designer"): Competitor => ({
  id,
  name,
  rating,
  reviews,
  primaryType,
  category,
});

// The Oct 22 test from the spec: "web design west jordan ut".
const WEST_JORDAN = [
  c("p1", "Utah Web Design Pros", 4.8, 25),
  c("p2", "LightStorm Design", 5.0, 21),
  c("p3", "King Me Digital", 5.0, 31),
  c("bould", "Bould Inc", 5.0, 5),
  ...Array.from({ length: 16 }, (_, i) => c(`x${i}`, `Other ${i}`, 4.6, 10)),
];

const lead = (p: Partial<LeadFacts> = {}): LeadFacts => ({
  placeId: "bould",
  status: "OPERATIONAL",
  rating: 5.0,
  reviews: 5,
  category: "Website designer",
  primaryType: "web_designer",
  ...p,
});

const Q = "web design west jordan ut";
const noFlags: SiteFlags = { noSite: false, slowMobile: false, noCall: false, noForm: false, mobileScore: 80 };

describe("diagnose (spec §3.3)", () => {
  it("reproduces the Bould test: around #4, reviews are the gap (E)", () => {
    expect(rankOf("bould", WEST_JORDAN)).toBe(4);
    const d = diagnose(lead(), WEST_JORDAN, Q, "West Jordan");
    expect(d.case).toBe("E");
    expect(d.say).toBe("The top 3 have 21–31 reviews. You have 5. Getting to about 31 is the gap.");
    expect(d.gap).toBe("26 reviews to go (5 → 31)");
  });

  it("A: no Google profile, or marked closed", () => {
    expect(diagnose(lead({ placeId: null }), WEST_JORDAN, "concrete contractor Provo UT", "Provo").say).toBe(
      "You're not on Google Maps yet, so people searching for concrete contractor can't find you. That's step one.",
    );
    expect(diagnose(lead({ status: "CLOSED_PERMANENTLY" }), WEST_JORDAN, Q, null).case).toBe("A");
  });

  it("B: not in the top 20 with a different category than the top 3", () => {
    const d = diagnose(lead({ placeId: "zzz", primaryType: "marketing_agency", category: "Marketing agency" }), WEST_JORDAN, Q, null);
    expect(d.case).toBe("B");
    expect(d.say).toBe("The top 3 are listed as Website designer. You're listed as Marketing agency, so Google doesn't show you for this search.");
  });

  it("C: not in the top 20, category matches (or is unknown)", () => {
    expect(diagnose(lead({ placeId: "zzz" }), WEST_JORDAN, Q, null).case).toBe("C");
    expect(diagnose(lead({ placeId: "zzz", primaryType: null }), WEST_JORDAN, Q, null).case).toBe("C");
  });

  it("D: ranked #4–20 under 4.5 stars; states the real top-3 ratings", () => {
    const d = diagnose(lead({ rating: 4.2 }), WEST_JORDAN, Q, null);
    expect(d.case).toBe("D");
    expect(d.say).toBe("Every top-3 business has 4.5 stars or higher. You're at 4.2.");
    const mixed = [c("p1", "A", 4.4, 25), ...WEST_JORDAN.slice(1)];
    expect(diagnose(lead({ rating: 4.2 }), mixed, Q, null).say).toBe("The top 3 are at 4.4, 5.0, 5.0 stars. You're at 4.2.");
  });

  it("F: in the top 20 and keeping up on reviews and rating", () => {
    const d = diagnose(lead({ reviews: 40 }), WEST_JORDAN, Q, null);
    expect(d.case).toBe("F");
    expect(d.say).toBe("Your reviews are strong. Reviews aren't what's holding you back.");
    // Close to #3 (25 vs 31): not a review gap, but not "strong" either.
    expect(diagnose(lead({ reviews: 25 }), WEST_JORDAN, Q, null).say).toMatch(/^Your reviews keep up/);
  });

  it("E only for a real gap: under half of #3, or 10+ behind", () => {
    expect(reviewGap(7, 10)).toBe(false); // Liebenow: 7 vs 8–10 isn't the gap
    expect(reviewGap(4, 10)).toBe(true);
    expect(reviewGap(30, 40)).toBe(true);
    expect(reviewGap(31, 40)).toBe(false);
  });

  it("B: only when no top-3 business shares the lead's category, also when ranked #4–20", () => {
    const mixedCats = [c("p1", "A", 4.8, 25), c("p2", "B", 5, 21, "marketing_agency", "Marketing agency"), ...WEST_JORDAN.slice(2)];
    // One of the top 3 is a marketing agency like the lead: the category isn't the problem.
    expect(diagnose(lead({ placeId: "zzz", primaryType: "marketing_agency", category: "Marketing agency" }), mixedCats, Q, null).case).toBe("C");
    const ranked = diagnose(lead({ primaryType: "marketing_agency", category: "Marketing agency" }), WEST_JORDAN, Q, null);
    expect(ranked.case).toBe("B");
    expect(ranked.say).toMatch(/ranks you lower/);
    // A search for a trade they don't offer can't be a category problem.
    expect(diagnose(lead({ placeId: "zzz", primaryType: "marketing_agency" }), WEST_JORDAN, Q, null, { offersService: false }).case).toBe("C");
  });

  it("G: already top 3, even under 4.5 stars", () => {
    expect(diagnose(lead({ placeId: "p2" }), WEST_JORDAN, Q, null).case).toBe("G");
    expect(diagnose(lead({ placeId: "p2", rating: 4.3 }), WEST_JORDAN, Q, null).case).toBe("G");
  });
});

describe("call order (Oct 28 2026 brief §6)", () => {
  const P = (kase: Parameters<typeof callPriority>[0]["case"], rank: number | null, flags = noFlags, more: { locationMismatch?: boolean; paying?: boolean } = {}) =>
    callPriority({ case: kase, rank, flags, ...more });
  const weak = { ...noFlags, grade: "Weak" as const };
  const strong = { ...noFlags, grade: "Strong" as const, noCall: true };

  it("1+: paying an agency or lead service and #4–20, even with no other gap", () => {
    expect(P("F", 7, noFlags, { paying: true })).toBe(0);
    expect(P("E", 12, noFlags, { paying: true })).toBe(0);
    expect(P("C", null, noFlags, { paying: true })).toBe(4); // not in the top 20: most work
  });

  it("1: #4–20 with a clear gap: category, rating, real review gap, location mismatch or weak site", () => {
    expect(P("E", 4)).toBe(1);
    expect(P("B", 9)).toBe(1);
    expect(P("D", 5)).toBe(1);
    expect(P("F", 6, noFlags, { locationMismatch: true })).toBe(1);
    expect(P("F", 6, weak)).toBe(1);
    expect(P("F", 6, { ...noFlags, noSite: true })).toBe(1);
  });

  it("2: top 3 with a weak or no website; Skip: top 3 with a site that passes", () => {
    expect(P("G", 2, weak)).toBe(2);
    expect(P("G", 1, { ...noFlags, noSite: true })).toBe(2);
    expect(P("G", 1, strong)).toBe(SKIP); // graded: one red flag doesn't make a strong site weak
    expect(P("G", 1, { ...noFlags, grade: "OK" })).toBe(SKIP);
    expect(P("G", 1, { ...noFlags, grade: "OK", noCall: true })).toBe(SKIP); // Jake: OK sites are skipped
    expect(P("G", 3, { ...noFlags, noCall: true })).toBe(2); // no grade yet: any flag counts
  });

  it("3: close, no clear gap; 4: not in the top 20 or not on Google", () => {
    expect(P("F", 8)).toBe(3);
    expect(P("A", null)).toBe(4);
    expect(P("C", null)).toBe(4);
    expect(P("B", null)).toBe(4);
  });

  it("removes excluded categories, closed, under 4.0 and no street address; never inbound", () => {
    const l = { ...lead({ rating: 3.8 }), address: "123 Main St, Provo" };
    expect(skipReason(l, false)).toMatch(/under 4.0/);
    expect(skipReason(l, true)).toBeNull();
    expect(skipReason({ ...lead({ reviews: 0 }), address: "1 Main" }, false)).toBeNull(); // no reviews isn't a removal any more
    expect(skipReason({ ...lead(), address: "Provo, UT" }, false)).toMatch(/No street address/);
    expect(skipReason({ ...lead(), address: "9 Center St" }, false)).toBeNull();
    expect(skipReason({ ...lead(), address: "9 Center St" }, false, "Excluded category: Labor union")).toBe("Excluded category: Labor union");
    expect(skipReason({ ...lead(), address: "9 Center St" }, true, "Excluded category: Labor union")).toBeNull();
  });
});

describe("helpers", () => {
  it("finds the top 3's category", () => {
    expect(topCategory([c("a", "a", 5, 1, "x", "X"), c("b", "b", 5, 1, "y", "Y"), c("c", "c", 5, 1, "y", "Y")]).category).toBe("Y");
  });
  it("strips the city from the search", () => {
    expect(serviceOf("concrete contractor pleasant grove", "Pleasant Grove")).toBe("concrete contractor");
    expect(serviceOf("smoke shop in Austin", "Austin")).toBe("smoke shop");
  });
  it("makes readable, unguessable slugs", () => {
    expect(makeSlug("Rubio Brothers Concrete", "Pleasant Grove", "k3x9")).toBe("rubio-brothers-concrete-pleasant-grove-k3x9");
    expect(makeSlug("L.S.G Quality Concrete", null, "ab12")).toBe("l-s-g-quality-concrete-ab12");
    expect(makeSlug("Pete's Auto & Tire", "Orem", "zz99")).toBe("pete-s-auto-and-tire-orem-zz99");
  });
});

describe("Meta Instant Form CSV", async () => {
  const { decodeCsv, parseMetaLeads } = await import("@/lib/check/meta-csv");
  const CSV = [
    "id\tcreated_time\tad_name\tcampaign_name\tbusiness_name\tcity\twhat_do_you_do?\tfull_name\tphone_number\temail",
    'l:123\t2026-11-02T10:00:00-0700\tTop 3 v1\tNov ranking check\tRubio Brothers Concrete\tPleasant Grove\tconcrete contractor\tMarco Rubio\tp:+18015550100\tmarco@example.com',
    'l:124\t2026-11-02T11:00:00-0700\tTop 3 v1\tNov ranking check\t"Pete\'s Auto, Repair"\tOrem\tauto repair\tPete\tp:+18015550101\t',
  ].join("\n");

  it("reads Meta's tab-separated export, custom questions and p: phones", () => {
    const { leads, missing } = parseMetaLeads(CSV);
    expect(missing).toEqual([]);
    expect(leads).toHaveLength(2);
    expect(leads[0]).toMatchObject({ metaId: "l:123", business: "Rubio Brothers Concrete", city: "Pleasant Grove", service: "concrete contractor", name: "Marco Rubio", phone: "+18015550100", campaign: "Nov ranking check" });
    expect(leads[1]).toMatchObject({ business: "Pete's Auto, Repair", email: null });
  });

  it("decodes UTF-16 with a BOM", () => {
    const text = "full_name,phone_number,business_name,city\nA,p:1,B,C";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    expect(parseMetaLeads(decodeCsv(bytes)).leads[0]).toMatchObject({ name: "A", business: "B", city: "C", phone: "1" });
  });
});
