import { lookup } from "node:dns/promises";
import * as cheerio from "cheerio";
import { coreName, norm } from "../discovery/match";
import { PARKED, fetchHome } from "./site";

// Websites Google doesn't link. Many owners have a site but never added it to their Google profile
// (Joshua & Sons Electricians, Eaton Metal Products). That's a different pitch from "no website":
// link it (a quick visibility win) and fix what the site loses.
// No search API: we try the addresses their name suggests (joshuaandsonselectricians.com…) and only
// accept a page that shows their phone number, or their full name and their city.

// phone / name = confirmed on the page. possible = an address made from their name is a live site
// behind a bot wall, so we couldn't read it: shown to the caller as "check it", never scored.
export type FoundSite = { url: string; how: "phone" | "name" | "possible" };

type Deps = {
  resolves: (host: string) => Promise<boolean>;
  fetchPage: (url: string) => Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; cause?: string | null }>;
};

const realDeps: Deps = {
  resolves: async (host) => {
    try {
      await Promise.race([lookup(host), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 4000))]);
      return true;
    } catch {
      return false;
    }
  },
  fetchPage: (url) => fetchHome(url, 10_000),
};

// Words that never help guess a domain on their own.
const FILLER = new Set(["and", "of", "llc", "inc"]);

/** Addresses their name suggests, most likely first: "Joshua & Sons Electricians" → joshuaandsonselectricians.com, joshuasonselectricians.com… */
export function candidateDomains(name: string): string[] {
  const words = coreName(name.replace(/&/g, " and ").replace(/['’]s\b/gi, "s")).split(" ").filter(Boolean);
  if (!words.length) return [];
  const all = words.join("");
  const noAnd = words.filter((w) => !FILLER.has(w)).join("");
  const firstTwo = words.length >= 3 ? words.filter((w) => !FILLER.has(w)).slice(0, 2).join("") : null;
  const stems = [...new Set([all, noAnd, firstTwo].filter((s): s is string => !!s && s.length >= 5 && s.length <= 40))];
  return [...stems.map((s) => `${s}.com`), ...stems.slice(0, 2).map((s) => `${s}.net`)];
}

/** Does this page belong to the lead? Their phone (last 7 digits), or every name word plus their city; their name alone = possible. */
export function pageMatches(html: string, lead: { name: string; city: string | null; phone: string | null }): FoundSite["how"] | null {
  if (PARKED.test(html)) return null;
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = norm(`${$("title").text()} ${$("body").text()}`);
  const digits = html.replace(/\D/g, "");
  const tel = (lead.phone ?? "").replace(/\D/g, "").slice(-7);
  if (tel.length === 7 && digits.includes(tel)) return "phone";
  const words = coreName(lead.name.replace(/&/g, " ").replace(/['’]s\b/gi, "s"))
    .split(" ")
    .filter((w) => w.length >= 3 && !FILLER.has(w));
  const city = lead.city ? norm(lead.city) : "";
  const named = words.length >= 2 && words.every((w) => ` ${text} `.includes(` ${w}`));
  if (named && city && text.includes(city)) return "name";
  // Their full name but not their phone or city: maybe a head office, maybe a namesake. Check it.
  return named ? "possible" : null;
}

/** Look for the lead's own website. Free: a few DNS lookups and page loads. */
export async function findSite(lead: { name: string; city: string | null; phone: string | null }, deps: Deps = realDeps): Promise<FoundSite | null> {
  let possible: FoundSite | null = null;
  for (const host of candidateDomains(lead.name)) {
    if (!(await deps.resolves(host))) continue;
    const page = await deps.fetchPage(`https://${host}/`);
    const www = page.ok ? page : await deps.fetchPage(`https://www.${host}/`);
    const got = www.ok || page.ok || page.cause !== "challenge" ? www : page;
    if (!got.ok) {
      // Only a bot wall proves a live site (a dead parking IP times out); a one-word name is too vague.
      if (got.cause === "challenge" && coreName(lead.name).split(" ").length >= 2) possible ??= { url: `https://${host}/`, how: "possible" };
      continue;
    }
    const how = pageMatches(got.html, lead);
    if (how === "possible") possible ??= { url: got.finalUrl, how };
    else if (how) return { url: got.finalUrl, how };
  }
  return possible;
}
