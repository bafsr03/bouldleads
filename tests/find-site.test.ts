import { describe, expect, it } from "vitest";
import { candidateDomains, findSite, pageMatches } from "@/lib/audit/find-site";

const lead = { name: "Joshua & Sons Electricians", city: "Tooele", phone: "(435) 555-0142" };
const page = (body: string) => `<html><head><title>Home</title></head><body>${body}</body></html>`;

describe("finding sites Google doesn't link", () => {
  it("guesses addresses from the name", () => {
    expect(candidateDomains("Joshua & Sons Electricians").slice(0, 2)).toEqual(["joshuaandsonselectricians.com", "joshuasonselectricians.com"]);
    expect(candidateDomains("Ross Automotive, Inc.")[0]).toBe("rossautomotive.com");
  });

  it("only accepts a page with their phone, or their name and city", () => {
    expect(pageMatches(page("Call us: 435-555-0142"), lead)).toBe("phone");
    expect(pageMatches(page("Joshua and Sons Electricians, serving Tooele County"), lead)).toBe("name");
    expect(pageMatches(page("Joshua & Sons Electricians, Denver CO"), lead)).toBe("possible");
    expect(pageMatches(page("Joshua's Bakery, Tooele"), lead)).toBeNull();
    expect(pageMatches(page("This domain is for sale. Call 435-555-0142"), lead)).toBeNull();
  });

  it("returns a confirmed site, and keeps looking past a bot wall", async () => {
    const found = await findSite(lead, {
      resolves: async (h) => h === "joshuaandsonselectricians.com" || h === "joshuasonselectricians.com",
      fetchPage: async (url) =>
        url.includes("joshuaandsons")
          ? { ok: false, cause: "challenge" }
          : { ok: true, html: page("Joshua & Sons · (435) 555-0142"), finalUrl: url },
    });
    expect(found).toEqual({ url: "https://joshuasonselectricians.com/", how: "phone" });
  });

  it("suggests a bot-walled site as 'possible', never a dead one", async () => {
    const walled = await findSite(lead, { resolves: async (h) => h.startsWith("joshuaandsons"), fetchPage: async () => ({ ok: false, cause: "challenge" }) });
    expect(walled).toEqual({ url: "https://joshuaandsonselectricians.com/", how: "possible" });
    const dead = await findSite(lead, { resolves: async () => true, fetchPage: async () => ({ ok: false, cause: "timeout" }) });
    expect(dead).toBeNull();
  });
});
