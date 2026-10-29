import { describe, expect, it } from "vitest";
import { analyzeHtml, builderIn, citiesIn, type SiteFacts } from "@/lib/audit/site";
import { SKIP, callPriority, diagnose, type Competitor, type LeadFacts } from "@/lib/check/diagnose";
import { customerQuery, excludedReason, searchPhrase, stateOf, DEFAULT_EXCLUDED, DEFAULT_EXCLUDED_RETAIL } from "@/lib/check/terms";
import { gradeSite, leadServiceLine, locationMismatch, payingFor, profileLinkProblem } from "@/lib/check/site-grade";
import { resolveCategory } from "@/lib/discovery/match";

// The four Rochester, MN leads from Jake's calls (Lead Sourcing & Scoring Improvements, Oct 28 2026 §2).
// Each must come out as the "What it should say" column.

const LISTS = { excluded: DEFAULT_EXCLUDED, retail: DEFAULT_EXCLUDED_RETAIL };
const YEAR = 2026;

const site = (html: string, url: string, city: string): SiteFacts => ({
  ...analyzeHtml(html, url, { city }),
  reachable: true,
  error: null,
  socialOnly: false,
  loadMs: 300,
  pageSpeed: null,
  contactPage: null,
});

const comp = (id: string, reviews: number, primaryType: string, category: string, rating = 4.9): Competitor => ({ id, name: id, rating, reviews, primaryType, category });
const flagsFor = (s: SiteFacts | null, ctx: { name: string; city: string; service: string }) => {
  const g = gradeSite(s, { ...ctx, year: YEAR });
  return { noSite: !s, slowMobile: false, noCall: false, noForm: false, mobileScore: null, grade: g?.grade ?? null };
};

describe("IBEW Local 343 → excluded (not a customer)", () => {
  const row = { name: "IBEW Local 343", category: null, google_type: "Association / Organization", category_confirmed: null, city: "Rochester", address: "4220 W Circle Dr NW, Rochester, MN 55901, USA", country_code: "US" };

  it("is excluded by its Google category", () => {
    expect(excludedReason({ ...row, primaryType: "association_or_organization" }, LISTS)).toBe("Excluded category: Association / Organization");
    expect(excludedReason({ category: null, google_type: "Labor union", primaryType: null }, LISTS)).toMatch(/Labor union/);
  });

  it("has no customer search: 'association / organization in Rochester' is never run", () => {
    expect(searchPhrase(row)).toBeNull();
    expect(customerQuery(row)).toBeNull();
  });

  it("isn't case B when #3 shares its category", () => {
    const top = [comp("a", 20, "electrician", "Electrician"), comp("b", 15, "electrician", "Electrician"), comp("c", 9, "association_or_organization", "Association")];
    const lead: LeadFacts = { placeId: "ibew", status: "OPERATIONAL", rating: 4.8, reviews: 30, category: "Association", primaryType: "association_or_organization" };
    expect(diagnose(lead, top, "electrician Rochester MN", "Rochester").case).not.toBe("B");
  });

  it("keeps retail out unless it's a retail list on purpose", () => {
    expect(excludedReason({ category: null, google_type: "Clothing store", primaryType: "clothing_store" }, LISTS)).toMatch(/Clothing store/);
    expect(excludedReason({ category: "Clothing & boutiques", google_type: "Clothing store", primaryType: "clothing_store" }, LISTS)).toBeNull();
    expect(excludedReason({ category: null, google_type: "Roofing contractor", primaryType: "roofing_contractor" }, LISTS)).toBeNull();
  });
});

const LIEBENOW_HTML = `<!doctype html><html><head><title>HOME</title></head><body>
<header><img src="/logo.png" alt="Liebenow logo"><a href="/">Home</a> <a href="/contact">Contact</a></header>
<h2>Our Services</h2><ul><li>Basement waterproofing</li><li>Foundation repair</li><li>Crack repair</li><li>Sump pumps</li>
<li>Drain tile</li><li>Window wells</li><li>Mudjacking</li><li>Egress windows</li></ul>
<p>Family owned since 1985. Call for a free estimate.</p>
<a href="https://www.homeadvisor.com/rated.LiebenowWaterproofing.123.html"><img src="/img/homeadvisor-badge.png" alt="HomeAdvisor screened"></a>
<footer>Liebenow Waterproofing · 255 Main St, Zumbrota, MN 55992 · © 2019</footer></body></html>`;

describe("Liebenow Waterproofing → Priority 1 (1+): location mismatch, weak site, paying for leads", () => {
  const row = { name: "Liebenow Waterproofing", category: "Plumbers", google_type: null, category_confirmed: 0, city: "Rochester", address: "1601 Broadway Ave N, Rochester, MN 55906, USA", country_code: "US" };
  const s = site(LIEBENOW_HTML, "https://liebenowwaterproofing.com/", "Rochester");

  it("is filed as waterproofing, not 'Plumbers?'", () => {
    expect(resolveCategory("Plumbers", row.name, {})).toEqual({ category: "Basement waterproofing", confirmed: true });
  });

  it("searches 'basement waterproofing Rochester MN'", () => {
    expect(stateOf(row.address)).toBe("MN");
    expect(customerQuery(row)).toBe("basement waterproofing Rochester MN");
  });

  it("reviews aren't the gap: 7 vs #1's 8", () => {
    const top = [comp("a", 8, "contractor", "Contractor"), comp("b", 6, "contractor", "Contractor"), comp("c", 5, "contractor", "Contractor"), comp("lieb", 7, "contractor", "Contractor")];
    const lead: LeadFacts = { placeId: "lieb", status: "OPERATIONAL", rating: 5, reviews: 7, category: "Contractor", primaryType: "contractor" };
    const d = diagnose(lead, top, "basement waterproofing Rochester MN", "Rochester");
    expect(d.case).toBe("F");
    expect(d.gap).toBeNull();
  });

  it("grades the one-page 'HOME' site Weak, weakest items first", () => {
    const g = gradeSite(s, { name: row.name, city: "Rochester", service: "basement waterproofing", year: YEAR })!;
    expect(g.grade).toBe("Weak");
    expect(g.weakest).toEqual(["8 services, no service pages", 'Title is "HOME"', "Never mentions Rochester"]);
  });

  it("flags the location mismatch and HomeAdvisor", () => {
    expect(s.addressCities).toEqual(["Zumbrota"]);
    expect(locationMismatch(s, "Rochester")).toBe("Your Google profile says Rochester, your website says Zumbrota. Google gets mixed signals about where you are.");
    expect(leadServiceLine(s.leadServices ?? [])).toBe("Uses HomeAdvisor. Ask what they spend a month.");
    expect(payingFor(s).paying).toBe(true);
  });

  it("is called first (1+), with the Growth plan pitch", () => {
    const flags = flagsFor(s, { name: row.name, city: "Rochester", service: "basement waterproofing" });
    expect(callPriority({ case: "F", rank: 4, flags, locationMismatch: true, paying: true })).toBe(0);
    // Without HomeAdvisor it's still Priority 1: location mismatch and a weak site.
    expect(callPriority({ case: "F", rank: 4, flags, locationMismatch: true, paying: false })).toBe(1);
  });
});

const ELITE_HTML = `<!doctype html><html><head><title>Pressure Washing &amp; Roof Cleaning in Rochester, MN | Elite Exterior Solutions</title></head><body>
<header><img src="/logo.svg" alt="Elite Exterior Solutions"><a href="tel:5075550100">(507) 555-0100</a>
<nav><a href="/pressure-washing">Pressure washing</a><a href="/roof-cleaning">Roof cleaning</a><a href="/house-washing">House washing</a>
<a href="/gutter-cleaning">Gutter cleaning</a><a href="/about">About</a><a href="/contact">Contact</a></nav></header>
<h1>Rochester's exterior cleaning experts</h1>
<p>${"We soft wash roofs, siding, decks and driveways across Rochester, Byron, Stewartville and Kasson. ".repeat(30)}</p>
<img src="/uploads/roof-before-after.jpg" alt="Roof before and after"><img src="/uploads/driveway.jpg" alt="Driveway cleaning">
<section><h2>What our customers say</h2><p>★★★★★ 248 Google reviews</p></section>
<form><input name="name"><input name="phone"><textarea name="msg"></textarea></form>
<footer>© ${YEAR} Elite Exterior Solutions · 2010 2nd St SW, Rochester, MN 55902 · Website by Big West Marketing</footer></body></html>`;

describe("Elite Exterior Solutions → Skip (top 3 + good site), 6-month callback", () => {
  const s = site(ELITE_HTML, "https://eliteexteriormn.com/", "Rochester");
  const row = { name: "Elite Exterior Solutions", category: "Window cleaning & pressure washing", google_type: "Pressure washing service", category_confirmed: 1, city: "Rochester", address: "2010 2nd St SW, Rochester, MN 55902, USA", country_code: "US" };

  it("searches 'pressure washing Rochester MN'", () => {
    expect(customerQuery(row)).toBe("pressure washing Rochester MN");
  });

  it("grades the site Strong and reads the builder", () => {
    const g = gradeSite(s, { name: row.name, city: "Rochester", service: "pressure washing", year: YEAR })!;
    expect(g.grade).toBe("Strong");
    expect(s.builder).toBe("Big West Marketing");
    expect(locationMismatch(s, "Rochester")).toBeNull();
  });

  it("is #1 with a strong site: Skip", () => {
    const top = [comp("elite", 248, "pressure_washing_service", "Pressure washing service"), comp("b", 90, "pressure_washing_service", "Pressure washing service"), comp("c", 40, "pressure_washing_service", "Pressure washing service")];
    const lead: LeadFacts = { placeId: "elite", status: "OPERATIONAL", rating: 4.9, reviews: 248, category: "Pressure washing service", primaryType: "pressure_washing_service" };
    const d = diagnose(lead, top, "pressure washing Rochester MN", "Rochester");
    expect(d.case).toBe("G");
    const flags = flagsFor(s, { name: row.name, city: "Rochester", service: "pressure washing" });
    expect(callPriority({ case: d.case, rank: 1, flags, paying: true })).toBe(SKIP);
  });
});

describe("Masterwork Solution LLC → 'deck builder rochester mn', and the site it really has", () => {
  const row = { name: "Masterwork Solution LLC", category: null, google_type: "Deck builder", category_confirmed: null, city: "Rochester", address: "Rochester, MN 55904, USA", country_code: "US" };

  it("searches the service, city and state, never just 'rochester'", () => {
    expect(customerQuery(row)).toBe("deck builder Rochester MN");
    expect(customerQuery({ ...row, google_type: null })).toBeNull(); // no service known: no check, not "rochester"
  });

  it("geocodes Rochester with its state (not Rochester, NY)", () => {
    expect(stateOf(row.address)).toBe("MN");
    expect(stateOf("Rochester, Minnesota")).toBe("MN");
    expect(stateOf("Rochester, NY 14604, USA")).toBe("NY");
  });

  it("flags a Google profile that links another domain", () => {
    const s = { ...site("<html><head><title>Deck Cares</title></head><body><p>Decks</p></body></html>", "https://deckcares.com/", "Rochester") };
    expect(profileLinkProblem({ website: "http://masterworksolution.com", email: null }, s)?.say).toBe(
      "Your Google listing sends people to masterworksolution.com, which forwards to deckcares.com.",
    );
    expect(profileLinkProblem({ website: "https://deckcares.com", email: "mike@masterworksolution.com" }, s)?.problem).toBe("mismatch");
    expect(profileLinkProblem({ website: null, email: null, found_site: "https://deckcares.com", found_site_how: "phone" }, null)?.problem).toBe("unlinked");
    expect(profileLinkProblem({ website: "https://deckcares.com", email: "mike@gmail.com" }, s)).toBeNull();
  });
});

describe("site readers", () => {
  it("reads builders, skipping platforms", () => {
    expect(builderIn("© 2025 Acme Roofing | Website design by EM EN Design | Privacy")).toBe("EM EN Design");
    expect(builderIn("Powered by WordPress")).toBeNull();
    expect(builderIn("Site by Tension Design. All rights reserved")).toBe("Tension Design");
  });
  it("reads towns from addresses", () => {
    expect(citiesIn("Visit us at 123 Main St Zumbrota, MN 55992 or call")).toEqual(["Zumbrota"]);
    expect(citiesIn("Serving Rochester, MN and Byron, Minnesota")).toEqual(["Rochester", "Byron"]);
  });
});
