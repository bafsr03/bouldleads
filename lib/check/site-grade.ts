import { norm } from "../discovery/match";
import type { SiteFacts } from "../audit/site";

// "Has a website" isn't enough (Lead Sourcing & Scoring Improvements §5): Liebenow has one, but it's one
// page titled "HOME". This grades the site the lead's Google profile sends people to, and runs the three
// new checks from §4: location mismatch, who built it / are they paying for leads, and the profile link.
// Pure functions: run-check.ts feeds them the stored website facts.

export type GradeItem = { id: string; label: string; weak: string; ok: boolean | null }; // null = couldn't measure
export type SiteGrade = { grade: "Strong" | "OK" | "Weak"; weakest: string[]; items: GradeItem[] };

const GENERIC_TITLE = /^(home|home page|homepage|welcome|index|untitled|default|main)\b/i;
const YEAR = () => new Date().getFullYear();

export type GradeContext = { name: string; city: string | null; service: string | null; year?: number };

/** The page title says what and where: not "HOME", not just the name, and the city or the service in it. */
export function titleOk(title: string | null, ctx: GradeContext): boolean {
  const t = (title ?? "").trim();
  if (!t || GENERIC_TITLE.test(t)) return false;
  const nt = norm(t);
  const nameOnly = nt === norm(ctx.name) || nt.replace(/\b(inc|llc|co|company|corp)\b/g, "").trim() === norm(ctx.name).replace(/\b(inc|llc|co|company|corp)\b/g, "").trim();
  if (nameOnly) return false;
  const words = (ctx.service ?? "").split(/\s+/).filter((w) => w.length >= 4).map(norm);
  const hasService = words.some((w) => nt.includes(w.slice(0, Math.max(4, w.length - 2))));
  const hasCity = !!ctx.city && nt.includes(norm(ctx.city));
  return hasService || hasCity;
}

/**
 * Strong / OK / Weak from the ten checks in §5, and the 2–3 weakest items for the card.
 * Only items we could measure count; a site we couldn't read gets no grade (null).
 */
export function gradeSite(site: SiteFacts | null, ctx: GradeContext): SiteGrade | null {
  if (!site || !site.reachable || site.error || site.socialOnly || site.directory) return null;
  const year = ctx.year ?? YEAR();
  const pages = site.contentPages;
  const listed = site.servicesListed ?? 0;
  const items: GradeItem[] = [
    { id: "title", label: "Page title", weak: site.title ? `Title is "${site.title.slice(0, 40)}"` : "No page title", ok: titleOk(site.title, ctx) },
    {
      id: "pages",
      label: "Service pages",
      weak: pages === 0 ? (listed > 1 ? `${listed} services, no service pages` : "One-page site, no service pages") : `${listed} services, ${pages} service pages`,
      ok: pages == null ? null : pages > 0 && (listed < 2 || pages >= listed),
    },
    { id: "town", label: "Town mentions", weak: `Never mentions ${ctx.city ?? "the town"}`, ok: site.mentionsCity ?? null },
    { id: "words", label: "Amount of content", weak: `Thin homepage (${site.words ?? 0} words)`, ok: site.words == null ? null : site.words >= 300 },
    {
      id: "photos",
      label: "Photos of work",
      weak: (site.stockPhotos ?? 0) > 0 && !site.workPhotos ? "Stock photos only" : "No photos of their work",
      ok: site.workPhotos == null ? null : site.workPhotos > 0,
    },
    { id: "reviews", label: "Reviews on site", weak: "No reviews or testimonials", ok: site.reviewsOnSite },
    { id: "call", label: "Click-to-call", weak: "No click-to-call", ok: site.tapToCall || site.whatsapp },
    { id: "form", label: "Quote form", weak: "No quote form", ok: site.form || !!site.booking || site.formMaybe },
    { id: "speed", label: "Mobile speed", weak: `Slow on a phone (${site.pageSpeed}/100)`, ok: site.pageSpeed == null ? null : site.pageSpeed >= 50 },
    {
      id: "fresh",
      label: "Freshness",
      weak: `Copyright ${site.copyrightYear}`,
      ok: site.copyrightYear == null ? null : site.copyrightYear > year - 3,
    },
  ];
  const weak = items.filter((i) => i.ok === false);
  // One-page sites and a generic title are what Jake sees first on the call: they lead the list.
  const order = ["pages", "title", "town", "photos", "words", "form", "call", "speed", "reviews", "fresh"];
  weak.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const grade = weak.length <= 1 ? "Strong" : weak.length <= 3 ? "OK" : "Weak";
  return { grade, weakest: weak.slice(0, 3).map((w) => w.weak), items };
}

// ---------- §4.1 Location mismatch ----------

/** "Your Google profile says Rochester, your website says Zumbrota." or null. */
export function locationMismatch(site: SiteFacts | null, profileCity: string | null): string | null {
  if (!site || !site.reachable || site.error || !profileCity) return null;
  const pc = norm(profileCity);
  const cities = (site.addressCities ?? []).filter((c) => norm(c) !== "");
  if (cities.length && !cities.some((c) => norm(c) === pc)) {
    return `Your Google profile says ${profileCity}, your website says ${cities[0]}. Google gets mixed signals about where you are.`;
  }
  if (site.mentionsCity === false) return `Your Google profile says ${profileCity}, but your website never mentions ${profileCity}. Google gets mixed signals about where you are.`;
  return null;
}

// ---------- §4.2 Who built it, are they paying for leads ----------

/** Lead services that mean money spent. Yelp counts too (Jake, Oct 29 2026). */
const PAID = new Set(["HomeAdvisor", "Angi", "Thumbtack", "Porch", "Yelp"]);

export function payingFor(site: SiteFacts | null): { builder: string | null; services: string[]; paying: boolean } {
  const builder = site?.builder ?? null;
  const services = site?.leadServices ?? [];
  return { builder, services, paying: !!builder || services.some((s) => PAID.has(s)) };
}

export function leadServiceLine(services: string[]): string | null {
  const paid = services.filter((s) => PAID.has(s));
  return paid.length ? `Uses ${paid.join(" and ")}. Ask what they spend a month.` : null;
}

// ---------- §4.3 Google profile website link ----------

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|comcast|att|sbcglobal|verizon|charter|frontier|centurylink|mchsi|q|me|mac|ymail|protonmail)\./i;
const site2 = (host: string) => host.replace(/^www\./, "").split(".").slice(-2).join(".");
const hostOf = (u: string | null | undefined) => {
  try {
    return u ? new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * What's wrong with the website link on the Google profile: dead, parked, forwards to another domain,
 * or not the site we found (their email domain or a site we matched by phone). null = it's fine.
 */
export function profileLinkProblem(
  row: { website: string | null; email: string | null; found_site?: string | null; found_site_how?: string | null },
  site: SiteFacts | null,
): { problem: "dead" | "parked" | "redirect" | "mismatch" | "unlinked"; say: string } | null {
  const linked = hostOf(row.website);
  const found = hostOf(row.found_site);
  if (!linked) {
    if (found && (row.found_site_how === "phone" || row.found_site_how === "name"))
      return { problem: "unlinked", say: `Your Google listing doesn't link your website (${found.replace(/^www\./, "")}).` };
    return null;
  }
  if (site?.error === "down") return { problem: "dead", say: "Your Google listing sends people to a dead page." };
  if (site?.error === "parked") return { problem: "parked", say: "Your Google listing sends people to a parked domain." };
  const final = hostOf(site?.url);
  if (final && site?.reachable && !site.socialOnly && !site.directory && site2(final) !== site2(linked))
    return { problem: "redirect", say: `Your Google listing sends people to ${site2(linked)}, which forwards to ${site2(final)}.` };
  const mail = row.email?.split("@")[1]?.toLowerCase();
  if (mail && !FREE_MAIL.test(mail) && site2(mail) !== site2(linked) && site2(mail) !== (final ? site2(final) : ""))
    return { problem: "mismatch", say: `Your Google listing sends people to ${site2(linked)}, but your email is @${mail}. Which one is your real site?` };
  return null;
}
