import { describe, expect, it } from "vitest";
import { analyzeHtml, type SiteFacts } from "@/lib/audit/site";
import { keywordsFor, scoreAudit, type AuditInputs, type GoogleFacts } from "@/lib/audit/score";

const GOOD_SITE = `<!doctype html><html><head>
<title>Smoke Shop in Austin | Cloud Nine Smoke</title>
<meta name="description" content="Glass, vapes and CBD in Austin.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Store","address":{"streetAddress":"1 Main"}}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
</head><body>
<header><a href="tel:+15125550100">(512) 555-0100</a></header>
<h1>Call now for today's deals</h1>
<form><input name="name"><input name="phone" type="tel"><textarea name="msg"></textarea></form>
<section><h2>What our customers say</h2></section>
<a href="https://www.facebook.com/cloudnine">fb</a><a href="https://www.yelp.com/biz/cloud-nine">yelp</a>
<a href="https://instagram.com/cloudnine">ig</a>
<img src="a.jpg" alt="store"><img src="b.jpg">
<footer>© 2026 Cloud Nine Smoke</footer>
</body></html>`;

const BAD_SITE = `<html><head><title>Home</title></head><body>
<p>Welcome! Call us 512 555 0199</p><form role="search"><input name="s"><button>Go</button></form>
<footer>Copyright 2018</footer></body></html>`;

const site = (html: string): SiteFacts => ({ ...analyzeHtml(html, "https://cloudnine.example/"), reachable: true, error: null, socialOnly: false, loadMs: 800, pageSpeed: null, contactPage: null });

const google = (p: Partial<GoogleFacts> = {}): GoogleFacts => ({
  checked: true,
  found: true,
  type: "Tobacco shop",
  rating: 4.7,
  reviewCount: 85,
  status: "OPERATIONAL",
  rank: 2,
  rankQuery: "smoke shop in Austin",
  brandedTop: true,
  ...p,
});

const inputs = (p: Partial<AuditInputs> = {}): AuditInputs => ({
  business: { name: "Cloud Nine Smoke", category: "Smoke shops & tobacconists", city: "Austin", phone: "(512) 555-0100", website: "https://cloudnine.example", email: "hi@cloudnine.example", status: "verified", source: "google" },
  site: site(GOOD_SITE),
  google: google(),
  keywords: keywordsFor(["Smoke shops & tobacconists", "Tobacco shop", "smoke shop"], ["smoke", "vape"]),
  year: 2026,
  ...p,
});

describe("analyzeHtml", () => {
  it("detects conversion features on a good site", () => {
    const s = site(GOOD_SITE);
    expect(s.viewport).toBe(true);
    expect(s.tapToCall).toBe(true);
    expect(s.phoneInHeader).toBe(true);
    expect(s.form).toBe(true);
    expect(s.reviewsOnSite).toBe(true);
    expect(s.schema).toBe(true);
    expect(s.analytics).toContain("Google Analytics/Tag Manager");
    expect(s.copyrightYear).toBe(2026);
    expect(s.profiles).toEqual(expect.arrayContaining(["Facebook", "Yelp", "Instagram"]));
    expect(s.imagesNoAlt).toBe(1);
    expect(s.phones).toContain("15125550100");
  });

  it("flags a weak site, and ignores search forms", () => {
    const s = site(BAD_SITE);
    expect(s.viewport).toBe(false);
    expect(s.tapToCall).toBe(false);
    expect(s.form).toBe(false);
    expect(s.copyrightYear).toBe(2018);
    expect(s.ctas).toContain("call us");
  });
});

describe("scoreAudit", () => {
  it("scores a strong business high on both sides", () => {
    const a = scoreAudit(inputs());
    expect(a.conversion.score).toBeGreaterThanOrEqual(90);
    // reviews 3 + map pack 3 + category 2 + branded 2 + name 1 + nap 1 = 12 (directories: Google, FB, Yelp, IG = 4 → +2)
    expect(a.visibility.score).toBe(14);
    // The site already converts: never pitch a rebuild.
    expect(a.verdict.key).toBe("visibility_program");
    expect(a.verdict.provisional).toBe(true);
    expect(a.pattern.key).toBe("solid");
    expect(a.pitch?.key).toBe("solid");
  });

  it("finds the Rubio pattern: visible on Google, weak site", () => {
    const a = scoreAudit(inputs({ site: site(BAD_SITE) }));
    expect(a.conversion.score).toBeLessThan(40);
    expect(a.pattern.key).toBe("rubio");
    expect(a.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["no_call", "no_mobile", "stale"]));
    expect(a.findings[0].severity).toBe(3);
    expect(["A", "B"]).toContain(a.tier);
  });

  it("treats lots of reviews but no website as a top lead", () => {
    const a = scoreAudit(inputs({ site: null, business: { ...inputs().business, website: null, email: null, status: "no_website" } }));
    expect(a.conversion.score).toBe(0);
    expect(a.pattern.key).toBe("demand_no_site");
    expect(a.findings[0].id).toBe("no_site");
    expect(a.tier).toBe("A");
    expect(a.pitch?.key).toBe("website");
    expect(a.site?.key).toBe("none");
    expect(["launch", "launch_visibility"]).toContain(a.verdict.key);
  });

  it("finds the Kilowash pattern: good site, invisible", () => {
    const a = scoreAudit(
      inputs({ google: google({ rating: 4.0, reviewCount: 3, rank: null, brandedTop: false }), business: { ...inputs().business, name: "Northside Co" } }),
    );
    expect(a.visibility.score).toBeLessThan(8);
    expect(a.pattern.key).toBe("kilowash");
    // Good site, weak profile: the visibility program, not a build.
    expect(a.verdict.key).toBe("visibility_program");
    expect(a.pitch?.key).toBe("visibility");
  });

  it("lets manual answers override and re-score", () => {
    const base = scoreAudit(inputs());
    const all = Object.fromEntries(base.visibility.checks.map((c) => [c.id, "pass" as const]));
    const a = scoreAudit(inputs(), { checks: all });
    expect(a.visibility.score).toBe(20);
    expect(a.visibility.open).toBe(0);
    expect(a.verdict.provisional).toBe(false);
    expect(a.visibility.checks.every((c) => c.overridden)).toBe(true);
  });

  it("marks closed or unreachable businesses as not a fit", () => {
    expect(scoreAudit(inputs({ google: google({ status: "CLOSED_PERMANENTLY" }) })).tier).toBe("not_fit");
    const dead: SiteFacts = { ...site(BAD_SITE), reachable: false, error: "down" };
    expect(scoreAudit(inputs({ site: dead, business: { ...inputs().business, phone: null, email: null } })).tier).toBe("not_fit");
  });

  it("works without Google data", () => {
    const a = scoreAudit(inputs({ google: { checked: false, found: false, type: null, rating: null, reviewCount: null, status: null, rank: null, rankQuery: null, brandedTop: null } }));
    expect(a.visibility.checks.find((c) => c.id === "gbp_reviews")!.state).toBe("unknown");
    expect(a.tier).not.toBe("not_fit");
  });
});

describe("keywordsFor", () => {
  it("drops generic words and singularises", () => {
    expect(keywordsFor(["Dentists & orthodontists"])).toEqual(["dentist", "orthodontist"]);
    expect(keywordsFor(["Smoke shops & tobacconists"])).not.toContain("shop");
  });
});

describe("missing data", () => {
  const down: SiteFacts = { ...site(BAD_SITE), reachable: false, error: "down" };
  const blocked: SiteFacts = { ...site(BAD_SITE), reachable: false, error: "blocked" };
  const noGoogle: GoogleFacts = { checked: false, found: false, type: null, rating: null, reviewCount: null, status: null, rank: null, rankQuery: null, brandedTop: null };

  it("raises a dead website but never gives tier A without proof of demand", () => {
    const a = scoreAudit(inputs({ site: down, google: noGoogle }));
    expect(a.findings[0].id).toBe("site_down");
    expect(a.pattern.key).toBe("site_down");
    expect(a.tier).not.toBe("A");
    expect(a.tierReason).toContain("Google");
  });

  it("does not score a site that blocked the check", () => {
    const a = scoreAudit(inputs({ site: blocked }));
    expect(a.conversion.measured).toBe(false);
    expect(a.findings.map((f) => f.id)).not.toContain("site_down");
    expect(a.pattern.key).toBe("unmeasured");
  });

  it("keeps a lead with only a contact form reachable", () => {
    const a = scoreAudit(inputs({ google: noGoogle, business: { ...inputs().business, phone: null, email: null, status: "no_email" } }));
    expect(a.tier).not.toBe("not_fit");
  });
});

describe("parked domains", () => {
  it("are scored like a dead website", () => {
    const parked: SiteFacts = { ...site(BAD_SITE), reachable: false, error: "parked" };
    const a = scoreAudit(inputs({ site: parked }));
    expect(a.conversion.note).toContain("parked");
    expect(a.findings[0].say).toContain("parked");
  });
});

describe("deep Google profile", () => {
  const deep = (p: Partial<import("@/lib/discovery/google-api").DeepFacts> = {}) => ({
    at: 0,
    reviewsSampled: 5,
    newestReviewDays: 12,
    photos: 10,
    ownerPhotos: 3,
    hours: true,
    description: false,
    ...p,
  });

  it("passes an active, complete profile", () => {
    const r = scoreAudit(inputs({ google: google({ deep: deep() }) }));
    const c = r.visibility.checks.find((x) => x.id === "gbp_fresh")!;
    expect(c).toMatchObject({ state: "pass", method: "auto" });
    expect(c.evidence).toMatch(/10\+ photos, hours set/);
  });

  it("turns stale reviews, few photos and missing hours into talking points", () => {
    const r = scoreAudit(inputs({ google: google({ deep: deep({ newestReviewDays: 300, photos: 2, hours: false }) }) }));
    expect(r.visibility.checks.find((x) => x.id === "gbp_fresh")).toMatchObject({ state: "fail" });
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["stale_reviews", "no_hours", "few_photos"]));
    expect(r.findings.find((f) => f.id === "stale_reviews")!.say).toMatch(/10 months ago/);
  });

  it("leaves the check for the call when there's no deep data", () => {
    const r = scoreAudit(inputs());
    expect(r.visibility.checks.find((x) => x.id === "gbp_fresh")).toMatchObject({ state: "unknown", method: "manual" });
  });

  it("reads Google's place details into facts", async () => {
    const { deepFacts } = await import("@/lib/discovery/google-api");
    const now = Date.parse("2026-10-14T00:00:00Z");
    const f = deepFacts(
      {
        displayName: { text: "Cloud Nine Smoke" },
        reviews: [{ publishTime: "2026-09-14T10:00:00Z" }, { publishTime: "2025-01-01T00:00:00Z" }],
        photos: [{ authorAttributions: [{ displayName: "Cloud Nine Smoke" }] }, { authorAttributions: [{ displayName: "A customer" }] }],
        regularOpeningHours: { weekdayDescriptions: ["Monday: 9 AM–9 PM"] },
      },
      now,
    );
    expect(f).toMatchObject({ reviewsSampled: 2, newestReviewDays: 29, photos: 2, ownerPhotos: 1, hours: true, description: false });
  });
});

describe("chains", () => {
  it("are capped at tier C", () => {
    const base = inputs({ site: null, business: { ...inputs().business, website: null }, google: google({ reviewCount: 400, rank: null }) });
    expect(["A", "B"]).toContain(scoreAudit(base).tier);
    const chain = scoreAudit({ ...base, business: { ...base.business, chain: true } });
    expect(chain.tier).toBe("C");
    expect(chain.tierReason).toMatch(/chain/);
  });
});

describe("website reliability", () => {
  it("spots pages drawn by JavaScript instead of calling them weak", async () => {
    const { isScriptOnly } = await import("@/lib/audit/site");
    const spa = `<html><head><title>Joe's Plumbing</title><script src="/static/js/main.3f9a2c.js"></script></head><body><div id="root"></div></body></html>`;
    expect(isScriptOnly(spa, 0)).toBe(true);
    expect(isScriptOnly(GOOD_SITE, analyzeHtml(GOOD_SITE, "https://x.example/").textChars)).toBe(false);
  });

  it("does not score a JavaScript-only site", () => {
    const s: SiteFacts = { ...site(BAD_SITE), reachable: false, error: "script" };
    const r = scoreAudit(inputs({ site: s }));
    expect(r.conversion.measured).toBe(false);
    expect(r.conversion.note).toMatch(/JavaScript/);
    expect(r.findings.map((f) => f.id)).not.toContain("no_form");
  });

  it("finds the contact page to check for a form or tap-to-call", async () => {
    const { contactUrl } = await import("@/lib/audit/site");
    expect(contactUrl(`<a href="/contacto">Contáctanos</a>`, "https://tienda.pe/")).toBe("https://tienda.pe/contacto");
    expect(contactUrl(`<a href="/about">About</a>`, "https://joes.example/")).toBe("https://joes.example/contact");
    expect(contactUrl(`<a href="https://facebook.com/contact">Contact</a>`, "https://joes.example/")).toBe("https://joes.example/contact");
  });
});

describe("conversion paths we used to miss", () => {
  const facts = (html: string) => analyzeHtml(html, "https://x.example/");
  it("counts a booking link or an embedded form tool", () => {
    expect(facts(`<a href="https://vallance-dental.portal.dental/">Book an appointment</a>`).booking).toBe("Online booking link");
    expect(facts(`<script src="https://js.hsforms.net/forms/v2.js"></script>`).form).toBe(true);
    expect(facts(`<script src="https://link.msgsndr.com/js/form_embed.js"></script>`).form).toBe(true);
  });
  it("leaves the form check open (not failed) when a quote page exists but its form isn't readable", () => {
    const f = facts(`<a href="/free-estimate">Get a free estimate</a>`);
    expect(f).toMatchObject({ form: false, formMaybe: true });
    const s: SiteFacts = { ...site(BAD_SITE), ...f, form: false, formMaybe: true, booking: null };
    const r = scoreAudit(inputs({ site: s }));
    expect(r.conversion.checks.find((c) => c.id === "site_form")!.state).toBe("unknown");
    expect(r.findings.map((x) => x.id)).not.toContain("no_form");
  });
});

describe("name says what they do", () => {
  it("matches word stems", () => {
    const k = keywordsFor(["Dentists & orthodontists", "Dentist", "dentist"]);
    const r = scoreAudit(inputs({ keywords: k, business: { ...inputs().business, name: "UrgentCare Dental Manchester", countryCode: "GB" } }));
    expect(r.visibility.checks.find((c) => c.id === "name_says")!.state).toBe("pass");
    const r2 = scoreAudit(inputs({ keywords: k, business: { ...inputs().business, name: "Smile Stylist", countryCode: "GB" } }));
    expect(r2.visibility.checks.find((c) => c.id === "name_says")!.state).toBe("fail");
  });
});

describe("unconfirmed category", () => {
  it("doesn't rank a lead for a type Google didn't confirm", async () => {
    const { serviceQuery } = await import("@/lib/audit/run-audit");
    const base = { category: "Motorcycles & powersports", city: "Tooele", country_code: "US" };
    expect(serviceQuery({ ...base, google_type: null, category_confirmed: 1 })).toBe("motorcycle dealer in Tooele");
    expect(serviceQuery({ ...base, google_type: "Services", category_confirmed: 0 })).toBeNull();
    expect(serviceQuery({ ...base, google_type: "Pawn Shop", category_confirmed: 0 })).toBe("pawn shop in Tooele");
  });

  it("matches a Google profile to its own lead only", async () => {
    const { profileMatches } = await import("@/lib/audit/run-audit");
    const lead = { name: "The Max Detail", lat: 40.598, lng: -112.457 };
    expect(profileMatches(lead, { displayName: { text: "Curby Bro's" }, location: { latitude: 40.6, longitude: -112.46 } })).toBe(false);
    expect(profileMatches(lead, { displayName: { text: "The Max Detail" }, location: { latitude: 40.5981, longitude: -112.4571 } })).toBe(true);
  });
});

// Calibration: leads from Jake's audit brief (Oct 2026), as fixtures. The ranking should agree with a person.
describe("ranking calibration", () => {
  const deep = { at: 0, reviewsSampled: 5, newestReviewDays: 200, photos: 3, ownerPhotos: 1, hours: true, description: false };
  const noSite = { ...inputs().business, website: null, email: null, status: "no_website" };

  it("ranks a good site with a weak profile as a visibility lead, not 'already solid' (Sky Bridge Roofing)", () => {
    const a = scoreAudit(inputs({ google: google({ rating: 5, reviewCount: 25, rank: 9, deep }) }));
    expect(a.conversion.score).toBeGreaterThanOrEqual(80);
    expect(a.pitch?.key).toBe("visibility");
    expect(a.verdict.key).toBe("visibility_program");
    expect(["A", "B"]).toContain(a.tier);
  });

  it("sinks chains to the bottom of the list (Tractor Supply)", () => {
    const a = scoreAudit(
      inputs({ site: null, business: { ...noSite, name: "Tractor Supply Co.", chainReason: "Chain or franchise (Tractor Supply)" }, google: google({ reviewCount: 900 }) }),
    );
    expect(a.priority).toBeLessThanOrEqual(25);
    expect(a.tier).toBe("C");
    expect(a.pitch?.key).toBe("corporate");
    expect(a.verdict.key).toBe("corporate");
    expect(a.tierReason).toMatch(/Corporate: Chain or franchise \(Tractor Supply\)/);
  });

  it("keeps a busy owner-run shop with no website at the top (Stott Plumbing)", () => {
    const a = scoreAudit(inputs({ site: null, business: { ...noSite, name: "Stott Plumbing" }, google: google({ rating: 4.8, reviewCount: 1184, rank: 4 }) }));
    expect(a.tier).toBe("A");
    expect(["website", "both"]).toContain(a.pitch?.key); // #4 on Maps: the bundle is fair too
    expect(a.priority).toBeGreaterThanOrEqual(75);
  });

  it("marks businesses we don't sell to as not a fit (gas stations, pawn shops)", () => {
    const a = scoreAudit(inputs({ business: { ...inputs().business, nonFit: "Not a fit: a gas station" } }));
    expect(a.tier).toBe("not_fit");
    expect(a.tierReason).toBe("Not a fit: a gas station");
  });

  it("allows tier A from 5 Google reviews", () => {
    const a = scoreAudit(inputs({ site: null, business: noSite, google: google({ reviewCount: 6, rating: 5, rank: 12 }) }));
    expect(a.tierReason).not.toMatch(/capped/);
    const b = scoreAudit(inputs({ site: null, business: noSite, google: google({ reviewCount: 4, rating: 5, rank: 12 }) }));
    expect(b.tierReason).toMatch(/fewer than 5 Google reviews/);
  });

  it("doesn't count unchecked visibility points as weakness", () => {
    const noGoogle: GoogleFacts = { checked: false, found: false, type: null, rating: null, reviewCount: null, status: null, rank: null, rankQuery: null, brandedTop: null };
    const a = scoreAudit(inputs({ google: noGoogle }));
    expect(a.needs?.visibility).toBe(0.5);
    // Strong on everything we could check: no visibility need at all.
    expect(scoreAudit(inputs()).needs?.visibility).toBe(0);
  });
});

describe("site status", () => {
  const dead = (cause: SiteFacts["cause"], error: SiteFacts["error"] = "down"): SiteFacts => ({ ...site(BAD_SITE), reachable: false, error, cause });

  it("says 'lapsed' only when the domain doesn't resolve", () => {
    const dns = scoreAudit(inputs({ site: dead("dns") }));
    expect(dns.site).toEqual({ key: "down", label: "Domain lapsed" });
    expect(dns.findings[0]).toMatchObject({ id: "site_down", severity: 3 });
    expect(dns.findings[0].say).toMatch(/lapsed/);
    const refused = scoreAudit(inputs({ site: dead("refused") }));
    expect(refused.site?.label).toBe("Site down");
    expect(refused.findings.find((f) => f.id === "site_down")!.say).not.toMatch(/lapsed/);
  });

  it("calls a slow or walled-off corporate site 'couldn't check', not down", () => {
    for (const cause of ["timeout", "tls", "challenge"] as const) {
      const a = scoreAudit(inputs({ site: dead(cause, "blocked") }));
      expect(a.site?.key).toBe("blocked");
      expect(a.findings.map((f) => f.id)).not.toContain("site_down");
      // First on Maps for their name, with a site we couldn't open: not "no website to own the results".
      expect(a.visibility.checks.find((c) => c.id === "branded")!.state).toBe("unknown");
    }
    expect(scoreAudit(inputs({ site: dead("tls", "blocked") })).conversion.note).toMatch(/certificate/);
  });

  it("keeps a Facebook page as 'Facebook only', a different pitch from no website", () => {
    const a = scoreAudit(inputs({ site: null, business: { ...inputs().business, website: null, socialUrl: "https://www.facebook.com/westsideauto" } }));
    expect(a.site).toEqual({ key: "social", label: "Facebook only" });
    expect(a.findings[0].say).toMatch(/Facebook page/);
    expect(a.conversion.note).toMatch(/Facebook/);
  });

  it("treats a directory listing as no site of their own", () => {
    const s: SiteFacts = { ...site(BAD_SITE), directory: true, url: "https://www.usmapelectric.org/curtiss" };
    const a = scoreAudit(inputs({ site: s }));
    expect(a.conversion.hasWebsite).toBe(false);
    expect(a.site?.key).toBe("directory");
  });
});
