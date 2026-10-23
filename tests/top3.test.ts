import { describe, expect, it } from "vitest";
import { SKIP, callPriority, diagnose, makeSlug, rankOf, serviceOf, skipReason, topCategory, type Competitor, type LeadFacts, type SiteFlags } from "@/lib/check/diagnose";

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
    expect(diagnose(lead({ placeId: null }), WEST_JORDAN, "concrete contractor in Provo", "Provo").say).toBe(
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
    expect(diagnose(lead({ reviews: 40 }), WEST_JORDAN, Q, null).case).toBe("F");
  });

  it("G: already top 3, even under 4.5 stars", () => {
    expect(diagnose(lead({ placeId: "p2" }), WEST_JORDAN, Q, null).case).toBe("G");
    expect(diagnose(lead({ placeId: "p2", rating: 4.3 }), WEST_JORDAN, Q, null).case).toBe("G");
  });
});

describe("call order (spec §3.4)", () => {
  it("puts one clear gap first, top 3 with a weak site second, and skips top 3 with a good site", () => {
    expect(callPriority("E", noFlags)).toBe(1);
    expect(callPriority("B", noFlags)).toBe(1);
    expect(callPriority("D", noFlags)).toBe(1);
    expect(callPriority("G", { ...noFlags, noCall: true })).toBe(2);
    expect(callPriority("F", noFlags)).toBe(3);
    expect(callPriority("A", noFlags)).toBe(4);
    expect(callPriority("C", noFlags)).toBe(4);
    expect(callPriority("G", noFlags)).toBe(SKIP);
  });

  it("filters cold leads, never inbound ones", () => {
    const l = { ...lead({ rating: 3.8 }), address: "123 Main St, Provo" };
    expect(skipReason(l, false)).toMatch(/under 4.0/);
    expect(skipReason(l, true)).toBeNull();
    expect(skipReason({ ...lead({ reviews: 0 }), address: "1 Main" }, false)).toBe("No Google reviews");
    expect(skipReason({ ...lead(), address: "Provo, UT" }, false)).toMatch(/No street address/);
    expect(skipReason({ ...lead(), address: "9 Center St" }, false)).toBeNull();
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
