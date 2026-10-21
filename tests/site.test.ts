import { afterEach, describe, expect, it, vi } from "vitest";
import { PARKED, addressVariants, checkSite, classifyFetchError } from "@/lib/audit/site";
import { normalizeWebsite, socialUrl } from "@/lib/discovery/overpass";
import { chainReason, formatPhone, nonFitReason, tollFree } from "@/lib/discovery/fit";

const PAGE = `<!doctype html><html><head><title>Action Roofing | Roofers in Tooele</title><meta name="viewport" content="width=device-width"></head>
<body><header><a href="tel:4355550100">(435) 555-0100</a></header><h1>Roof repair and replacement in Tooele County</h1>
<p>${"Family owned roofing company serving Tooele, Grantsville and Stansbury Park since 1998. ".repeat(8)}</p>
<form><input name="name"><input name="phone"><textarea name="msg"></textarea></form></body></html>`;

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
const fail = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

/** Fake network: url → response or error code. Unknown URLs refuse the connection. robots.txt is a 404. */
function net(routes: Record<string, Response | string>) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    seen.push(url);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    const r = routes[url];
    if (r === undefined) throw fail("ECONNREFUSED");
    if (typeof r === "string") {
      if (r === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      throw fail(r);
    }
    const c = r.clone();
    if (r.url) Object.defineProperty(c, "url", { value: r.url }); // a redirect's final address
    return c;
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("site check errors", () => {
  it("only calls a site down when the domain doesn't resolve or nothing answers", () => {
    expect(classifyFetchError(fail("ENOTFOUND"))).toEqual({ error: "down", cause: "dns" });
    expect(classifyFetchError(fail("ECONNREFUSED"))).toEqual({ error: "down", cause: "refused" });
    expect(classifyFetchError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toEqual({ error: "blocked", cause: "timeout" });
    expect(classifyFetchError(fail("ERR_TLS_CERT_ALTNAME_INVALID"))).toEqual({ error: "blocked", cause: "tls" });
    expect(classifyFetchError(fail("CERT_HAS_EXPIRED"))).toEqual({ error: "blocked", cause: "tls" });
    expect(classifyFetchError(fail("ECONNRESET"))).toEqual({ error: "blocked", cause: "reset" });
  });

  it("lists the other addresses to try", () => {
    expect(addressVariants("https://actionroofing.com/")).toEqual(["https://www.actionroofing.com/", "http://actionroofing.com/", "http://www.actionroofing.com/"]);
    expect(addressVariants("https://www.x.com/about")).toEqual(["https://www.x.com/", "https://x.com/", "http://www.x.com/", "http://x.com/"]);
  });

  it("recognises dead builder pages", () => {
    expect(PARKED.test("<h1>Looks like this domain isn't connected to a website yet!</h1>")).toBe(true); // Wix
    expect(PARKED.test("<title>Website Expired</title>")).toBe(true); // Squarespace
    expect(PARKED.test("<h1>Roof repair in Tooele</h1>")).toBe(false);
  });
});

describe("checkSite", () => {
  it("falls back to www when the bare domain's certificate fails (Action Roofing)", async () => {
    net({ "https://actionroofing.com/": "ERR_TLS_CERT_ALTNAME_INVALID", "https://www.actionroofing.com/": html(PAGE) });
    const s = await checkSite("https://actionroofing.com/", { pageSpeed: false });
    expect(s.reachable).toBe(true);
    expect(s.error).toBeNull();
    expect(s.tapToCall).toBe(true);
  });

  it("calls a corporate site that stalls 'couldn't check', not down (Tractor Supply)", async () => {
    net({ "https://www.tractorsupply.com/tsc/store_StansburyPark": "timeout", "https://www.tractorsupply.com/": "timeout", "https://tractorsupply.com/": "timeout" });
    const s = await checkSite("https://www.tractorsupply.com/tsc/store_StansburyPark", { pageSpeed: false });
    expect(s).toMatchObject({ reachable: false, error: "blocked", cause: "timeout" });
  });

  it("treats a bot wall as 'couldn't check'", async () => {
    net({ "https://menswearhouse.com/": html("<html><head><title>Just a moment...</title></head><body></body></html>", 403, { "cf-mitigated": "challenge" }) });
    expect(await checkSite("https://menswearhouse.com/", { pageSpeed: false })).toMatchObject({ error: "blocked", cause: "challenge" });
  });

  it("says down only when no address resolves", async () => {
    net({
      "https://pristineshine.com/": "ENOTFOUND",
      "https://www.pristineshine.com/": "ENOTFOUND",
      "http://pristineshine.com/": "ENOTFOUND",
      "http://www.pristineshine.com/": "ENOTFOUND",
    });
    expect(await checkSite("https://pristineshine.com/", { pageSpeed: false })).toMatchObject({ error: "down", cause: "dns" });
  });

  it("spots a /lander redirect and a Wix 'not connected' page as parked", async () => {
    const lander = html("<html><body>Search ads</body></html>");
    Object.defineProperty(lander, "url", { value: "https://eljefetowing.com/lander" });
    net({ "https://eljefetowing.com/": lander });
    expect(await checkSite("https://eljefetowing.com/", { pageSpeed: false })).toMatchObject({ error: "parked" });
    net({ "https://801cleaning.com/": html("<h1>Looks like this domain isn't connected to a website yet!</h1>") });
    expect(await checkSite("https://801cleaning.com/", { pageSpeed: false })).toMatchObject({ error: "parked" });
  });

  it("treats a directory listing as no site of their own", async () => {
    const s = await checkSite("https://www.usmapelectric.org/utah/curtiss-electric", { pageSpeed: false });
    expect(s).toMatchObject({ directory: true, reachable: true });
  });
});

describe("social links", () => {
  it("keeps a Facebook or Yelp page instead of dropping it", () => {
    expect(normalizeWebsite("https://www.facebook.com/westsideautosales")).toBeNull();
    expect(socialUrl("https://www.facebook.com/westsideautosales")).toBe("https://www.facebook.com/westsideautosales");
    expect(socialUrl("https://www.yelp.com/biz/village-cobbler")).toMatch(/yelp/);
    expect(socialUrl("https://clearchoiceroofingatx.com")).toBeNull();
    expect(normalizeWebsite("https://clearchoiceroofingatx.com")).toBe("https://clearchoiceroofingatx.com/");
  });
});

describe("fit", () => {
  it("spots chains by brand, toll-free number or store-locator page", () => {
    expect(chainReason({ name: "Tractor Supply Co." })).toMatch(/Tractor Supply/);
    expect(chainReason({ name: "Tooele Discount Tire" })).toMatch(/Discount Tire/);
    expect(chainReason({ name: "Stott Plumbing" })).toBeNull();
    expect(chainReason({ name: "Big Rig Repair", phone: "(888) 555-0100" })).toMatch(/Toll-free/);
    expect(chainReason({ name: "Best Paint", website: "https://bestpaint.com/locations/tooele" })).toMatch(/branch page/);
    expect(tollFree("+1 801 555 0100")).toBe(false);
  });

  it("marks gas stations, pawn shops and parks as not a fit, unless that's what was searched", () => {
    expect(nonFitReason({ name: "Delle City Station", googleLabel: "Gas station" })).toBe("Not a fit: a gas station");
    expect(nonFitReason({ name: "Hy & Mike's Pawn", googleLabel: null })).toBe("Not a fit: a pawn shop");
    expect(nonFitReason({ name: "Hy & Mike's Pawn", categoryId: "second_hand" })).toBeNull();
    expect(nonFitReason({ name: "Fielding Garr Ranch", googleLabel: "State park" })).toBe("Not a fit: a park");
    expect(nonFitReason({ name: "Sky Bridge Roofing", googleLabel: "Roofing contractor" })).toBeNull();
  });

  it("formats phones one way", () => {
    expect(formatPhone("+14358509805")).toBe("(435) 850-9805");
    expect(formatPhone("+1-801-555-1234")).toBe("(801) 555-1234");
    expect(formatPhone("+51 1 234 5678", "PE")).toBe("+51 1 234 5678");
  });
});
