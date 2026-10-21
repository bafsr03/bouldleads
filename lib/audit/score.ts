import type { SiteFacts } from "./site";
import type { DeepFacts } from "../discovery/google-api";

// The Bould Golden Formula, as code.  Leads = Visibility × Conversion.
//
// Visibility: the playbook's stage-2 audit, 12 checks worth 20 points. Each check is
//   auto       measured from Google / the website
//   estimated  a reasonable proxy; confirm it on the call
//   manual     only the owner or a person can answer it
// A manual answer always overrides the automatic one.
// Conversion: the stage-5 build standard, checked on the live homepage, scored 0-100.
// This file is pure (no I/O) so a re-score after a manual answer is instant and testable.

export type CheckState = "pass" | "fail" | "unknown";
export type Method = "auto" | "estimated" | "manual";

export type Check = {
  id: string;
  label: string;
  group: string;
  points: number;
  state: CheckState;
  method: Method;
  evidence: string | null;
  overridden?: boolean;
};

export type Finding = { id: string; severity: 1 | 2 | 3; say: string; email: string };

export type GoogleFacts = {
  checked: boolean; // false = no key / allowance used up
  found: boolean;
  type: string | null;
  rating: number | null;
  reviewCount: number | null;
  status: string | null;
  rank: number | null; // 1-based position in "service in city", null = not in top 20
  rankQuery: string | null;
  brandedTop: boolean | null; // their own name search shows them first
  note?: string | null;
  deep?: DeepFacts | null; // reviews/photos/hours from the deep audit (top leads)
};

export type BusinessFacts = {
  name: string;
  category: string | null;
  categoryConfirmed?: boolean; // false = only the search term; Google didn't confirm what they do
  city: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  status: string;
  source: string;
  countryCode?: string | null;
  chain?: boolean;
  chainReason?: string | null; // "Chain or franchise (Tractor Supply)", "Toll-free main number…" (see discovery/fit.ts)
  nonFit?: string | null; // "Not a fit: a gas station"
  socialUrl?: string | null; // the Facebook / Instagram / Yelp page Google lists as their website
  unlinkedSite?: boolean; // `website` is a site we found that their Google profile doesn't link
  possibleSite?: string | null; // a site that may be theirs (couldn't confirm): "check it"
};

export type ManualAnswers = { checks?: Record<string, "pass" | "fail">; notes?: string };

export type AuditInputs = { business: BusinessFacts; site: SiteFacts | null; google: GoogleFacts; keywords: string[]; year: number };

export type AuditResult = {
  version: 1;
  visibility: { score: number; max: 20; open: number; checks: Check[] };
  conversion: { score: number; hasWebsite: boolean; measured: boolean; note: string | null; checks: Check[] };
  verdict: { key: keyof typeof VERDICTS; label: string; offer: string; expectation: string; provisional: boolean };
  pattern: { key: string; label: string; explain: string };
  /** What to sell: website, visibility, both, corporate (don't cold call) or solid (light touch). */
  pitch?: { key: PitchKey; label: string };
  /** How much each side needs work, 0-1, on what we could check. */
  needs?: { website: number; visibility: number };
  /** One status for their website, shown as a chip everywhere. */
  site?: { key: SiteKey; label: string };
  priority: number;
  tier: "A" | "B" | "C" | "not_fit";
  tierReason: string;
  findings: Finding[];
  inputs: AuditInputs;
};

export type PitchKey = "website" | "visibility" | "both" | "corporate" | "solid";
export type SiteKey = "none" | "social" | "directory" | "down" | "parked" | "blocked" | "unchecked" | "unlinked" | "possible" | "ok";

export const PITCHES: Record<PitchKey, string> = {
  website: "Website",
  visibility: "Visibility",
  both: "Website + visibility",
  corporate: "Corporate",
  solid: "Light touch",
};

/** "Facebook only", "Yelp only"… for a lead whose "website" is a social or directory page. */
export function socialLabel(url: string | null | undefined): string {
  let host = "";
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {}
  const name = /facebook|fb\.com/.test(host) ? "Facebook" : /instagram/.test(host) ? "Instagram" : /yelp/.test(host) ? "Yelp" : /tiktok/.test(host) ? "TikTok" : null;
  return name ? `${name} only` : "Listing only";
}

/** The site chip: No site · Facebook only · Down · Parked · Couldn't check · (ok). */
export function siteState(b: Pick<BusinessFacts, "website" | "socialUrl" | "unlinkedSite" | "possibleSite">, site: SiteFacts | null): { key: SiteKey; label: string } {
  if (!b.website)
    return b.socialUrl
      ? { key: "social", label: socialLabel(b.socialUrl) }
      : b.possibleSite
        ? { key: "possible", label: "Maybe a site" }
        : { key: "none", label: "No site" };
  if (!site) return { key: "unchecked", label: "Not checked yet" };
  if (site.socialOnly) return { key: "social", label: socialLabel(site.url ?? b.website) };
  if (site.directory) return { key: "directory", label: socialLabel(site.url ?? b.website) };
  if (site.error === "parked") return { key: "parked", label: "Parked domain" };
  if (site.error === "down") return { key: "down", label: site.cause === "dns" ? "Domain lapsed" : "Site down" };
  if (site.error === "blocked" || site.error === "script" || !site.reachable) return { key: "blocked", label: "Couldn't check" };
  return b.unlinkedSite ? { key: "unlinked", label: "Site not on Google" } : { key: "ok", label: "Has a site" };
}

// ---------- Visibility: playbook stage 2 (20 points) ----------

export const VISIBILITY_CHECKS: { id: string; label: string; group: string; points: number }[] = [
  { id: "gbp_verified", label: "Google profile verified, owner can add Bould as manager", group: "Google Business Profile", points: 2 },
  { id: "gbp_category", label: "Primary category matches the main service people search", group: "Google Business Profile", points: 2 },
  { id: "gbp_reviews", label: "20+ Google reviews at 4.5 stars or higher", group: "Google Business Profile", points: 3 },
  { id: "gbp_fresh", label: "Profile active and complete (recent reviews, 5+ photos, hours)", group: "Google Business Profile", points: 1 },
  { id: "map_pack", label: 'Shows in the map pack for "main service + their city"', group: "Search presence", points: 3 },
  { id: "branded", label: "Owns the search results for their own business name", group: "Search presence", points: 2 },
  { id: "directories", label: "Listed on 4+ directories (Yelp, BBB, Angi, Facebook, Nextdoor, Apple Maps)", group: "Search presence", points: 2 },
  { id: "nap", label: "Name, phone, and address identical everywhere", group: "Search presence", points: 1 },
  { id: "name_says", label: "Business name says what they do", group: "Focus and demand", points: 1 },
  { id: "one_market", label: "Serves one market that matches the Google profile", group: "Focus and demand", points: 1 },
  { id: "busy_season", label: "Launch lands before or during their busy season", group: "Focus and demand", points: 1 },
  { id: "knows_leads", label: "We know their current leads per month and where they come from", group: "Focus and demand", points: 1 },
];

/** "3 weeks ago", "8 months ago" */
function ago(days: number): string {
  if (days < 14) return days <= 1 ? "this week" : `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function visibility(i: AuditInputs): Check[] {
  const { business: b, site, google: g } = i;
  const out: Record<string, Omit<Check, "id" | "label" | "group" | "points">> = {};
  const noKey = !g.checked;
  const googleNote = noKey ? (g.note ?? "Add a Google Places key in Settings to check this automatically") : null;

  // 1. Verified / manager access: Google doesn't expose ownership. A missing profile is a clear fail.
  out.gbp_verified =
    g.checked && !g.found
      ? { state: "fail", method: "auto", evidence: "No Google Business Profile found near this address" }
      : { state: "unknown", method: "manual", evidence: g.found ? "Profile exists; ask the owner if they can add a manager" : googleNote };

  // 2. Category matches the main service
  if (g.found && b.categoryConfirmed === false)
    out.gbp_category = {
      state: "unknown",
      method: "manual",
      evidence: `Search found them as "${b.category}"${g.type ? `; Google lists "${g.type}"` : ""}. Check the profile for what they really do.`,
    };
  else if (g.found && g.type) {
    const t = norm(g.type);
    const match = i.keywords.some((k) => t.includes(k));
    out.gbp_category = match
      ? { state: "pass", method: "estimated", evidence: `Google category: ${g.type}` }
      : { state: "unknown", method: "estimated", evidence: `Google category is "${g.type}". Is that their main service?` };
  } else out.gbp_category = { state: g.checked && !g.found ? "fail" : "unknown", method: g.checked ? "auto" : "manual", evidence: g.found ? "No category on profile" : googleNote };

  // 3. 20+ reviews at 4.5+
  if (g.found) {
    const n = g.reviewCount ?? 0;
    const r = g.rating;
    out.gbp_reviews = {
      state: n >= 20 && (r ?? 0) >= 4.5 ? "pass" : "fail",
      method: "auto",
      evidence: n ? `${n} review${n === 1 ? "" : "s"} at ${r?.toFixed(1)}★` : "No Google reviews yet",
    };
  } else out.gbp_reviews = { state: g.checked ? "fail" : "unknown", method: g.checked ? "auto" : "manual", evidence: g.checked ? "No Google profile" : googleNote };

  // 4. Active and complete profile: from the deep audit when we have it, otherwise check by hand.
  const d = g.deep;
  if (g.found && d) {
    const recent = d.newestReviewDays != null && d.newestReviewDays <= 90;
    const gaps = [
      !recent && (d.newestReviewDays == null ? "no reviews to date" : `newest review ${ago(d.newestReviewDays)}`),
      d.photos < 5 && `${d.photos === 0 ? "no" : `only ${d.photos}`} photo${d.photos === 1 ? "" : "s"}`,
      !d.hours && "no opening hours",
    ].filter(Boolean);
    out.gbp_fresh = gaps.length
      ? { state: "fail", method: "auto", evidence: `Profile gaps: ${gaps.join(", ")}` }
      : { state: "pass", method: "auto", evidence: `Newest review ${ago(d.newestReviewDays!)}, ${d.photos >= 10 ? "10+" : d.photos} photos, hours set` };
  } else out.gbp_fresh = { state: "unknown", method: "manual", evidence: g.found ? "Open the profile and check the newest review, photos and hours (or run a Deep audit)" : googleNote };

  // 5. Map pack
  if (g.found && g.rankQuery) {
    out.map_pack = {
      state: g.rank != null && g.rank <= 3 ? "pass" : "fail",
      method: "auto",
      evidence: g.rank ? `#${g.rank} on Google Maps for "${g.rankQuery}"` : `Not in the top 20 on Google Maps for "${g.rankQuery}"`,
    };
  } else out.map_pack = { state: g.checked && !g.found ? "fail" : "unknown", method: g.checked ? "auto" : "manual", evidence: g.checked && !g.found ? "No Google profile, so no map listing" : googleNote };

  // 6. Owns their branded search: approximated by "Maps shows them first for their name" + a real website.
  const realSite = !!site && site.reachable && !site.socialOnly && !site.directory;
  // A site that exists but blocked or outlasted our check isn't "no website": we just don't know.
  const unmeasuredSite = !!b.website && !!site && !site.reachable && site.error !== "down" && site.error !== "parked";
  if (g.found && g.brandedTop && unmeasuredSite)
    out.branded = { state: "unknown", method: "manual", evidence: "First on Maps for their name. Their site couldn't be checked: search their name on Google" };
  else if (g.found && g.brandedTop != null) {
    out.branded = {
      state: g.brandedTop && realSite ? "pass" : "fail",
      method: "estimated",
      evidence: !g.brandedTop ? "Another business shows first when searching their name on Maps" : realSite ? "First on Maps for their name, with their own website" : "First on Maps for their name, but no website to own the results",
    };
  } else
    out.branded =
      realSite || unmeasuredSite
        ? { state: "unknown", method: "manual", evidence: "Search their exact name on Google" }
        : { state: "fail", method: "estimated", evidence: "No website, so other sites own their name" };

  // 7. Directories: Google + OSM + profiles linked from their website. We don't query the directories
  // themselves, so fewer than 4 is "check it", never a fail (and unknowns don't count against them).
  const dirs = new Set<string>(site?.profiles.filter((p) => !["YouTube", "LinkedIn", "X / Twitter", "TikTok"].includes(p)) ?? []);
  if (g.found) dirs.add("Google Maps");
  if (b.source === "osm" || b.source === "both") dirs.add("OpenStreetMap / Apple Maps");
  out.directories = {
    state: dirs.size >= 4 ? "pass" : "unknown",
    method: "estimated",
    evidence: dirs.size ? `Seen on: ${[...dirs].join(", ")}. Check Yelp, BBB and Facebook for the rest` : "No listings linked from their site: check Yelp, BBB and Facebook",
  };

  // 8. NAP consistency: phone on the website vs. the listing phone.
  const listing = b.phone?.replace(/\D/g, "").slice(-7);
  if (listing && listing.length === 7 && site?.phones.length) {
    const same = site.phones.some((p) => p.endsWith(listing));
    out.nap = { state: same ? "pass" : "fail", method: "estimated", evidence: same ? "Website phone matches the listing" : `Website shows a different phone than the listing (${b.phone})` };
  } else out.nap = { state: "unknown", method: "manual", evidence: "Compare name, phone and address on Google, Yelp and Facebook" };

  // 9. Name says what they do
  const name = norm(b.name);
  // Match word stems too: "dental" says dentist, "roofing" says roofer, "plumbing" says plumber.
  const stem = (k: string) => (k.length >= 6 ? k.slice(0, 4) : k);
  const nameWords = name.split(/[^a-z0-9]+/);
  const says = i.keywords.find((k) => k.length >= 3 && (name.includes(k) || nameWords.some((w) => w.length >= 4 && w.startsWith(stem(k)))));
  out.name_says = says
    ? { state: "pass", method: "auto", evidence: `"${b.name}" includes "${says}"` }
    : b.chainReason
      ? { state: "unknown", method: "manual", evidence: "A brand name: this check doesn't apply to a chain" }
      : english(b.countryCode)
      ? { state: "fail", method: "auto", evidence: `"${b.name}" doesn't say what they do` }
      : { state: "unknown", method: "manual", evidence: `Does "${b.name}" say what they do? (automatic check is English-only)` };

  // 10–12: only the owner knows.
  out.one_market = { state: "unknown", method: "manual", evidence: "Ask which cities they want to drive to / serve" };
  out.busy_season = { state: "unknown", method: "manual", evidence: "Ask when their busy season starts" };
  out.knows_leads = { state: "unknown", method: "manual", evidence: "Ask: where do customers come from today, and how many a month?" };

  return VISIBILITY_CHECKS.map((c) => ({ ...c, ...out[c.id] }));
}

// ---------- Conversion: playbook stage 5 build standard (0-100) ----------

function conversion(i: AuditInputs): Check[] {
  const s = i.site;
  const c = (id: string, label: string, points: number, pass: boolean | null, evidence: string | null): Check => ({
    id,
    label,
    group: "Website",
    points,
    state: pass == null ? "unknown" : pass ? "pass" : "fail",
    method: "auto",
    evidence,
  });
  const city = i.business.city ? norm(i.business.city) : null;
  const title = s?.title ? norm(s.title) : "";
  const stale = s?.copyrightYear != null && s.copyrightYear < i.year - 1;
  const fast = s?.pageSpeed != null ? s.pageSpeed >= 90 : s?.loadMs != null ? s.loadMs < 2500 && (s.kb ?? 0) < 1500 : null;
  return [
    c("site_https", "Secure (https)", 5, s ? s.https : null, s?.url ?? null),
    c("site_mobile", "Built for phones (mobile viewport)", 10, s ? s.viewport : null, s && !s.viewport ? "No mobile viewport tag: likely tiny text on phones" : null),
    c(
      "site_call",
      "One-tap calling (tel: or WhatsApp link)",
      15,
      s ? s.tapToCall || s.whatsapp : null,
      s ? (s.tapToCall ? "Tap-to-call link found" : s.whatsapp ? "WhatsApp link found" : "Phone isn't clickable on the homepage or contact page") : null,
    ),
    c("site_phone_top", "Phone number in the header", 5, s ? s.phoneInHeader : null, null),
    c(
      "site_form",
      "Quote form, booking or online ordering",
      15,
      s ? (s.form || !!s.booking || s.ecommerce ? true : s.formMaybe ? null : false) : null,
      s
        ? s.booking
          ? `Uses ${s.booking}`
          : s.ecommerce
            ? "Has online ordering / cart"
            : s.form
              ? s.contactPage
                ? "Contact/quote form on the contact page (not the homepage)"
                : "Contact/quote form on the homepage"
              : s.formMaybe
                ? "Has a quote/contact link, but the form is drawn by JavaScript: check it on their site"
                : "No form, booking or ordering on the homepage or contact page"
        : null,
    ),
    c("site_cta", "Clear call to action", 10, s ? s.ctas.length > 0 : null, s?.ctas.length ? `"${s.ctas.slice(0, 3).join('", "')}"` : null),
    c("site_reviews", "Reviews or testimonials on the site", 10, s ? s.reviewsOnSite : null, null),
    c(
      "site_title",
      'Page title says "service in city"',
      10,
      // The service is what matters; a place name in the title is a plus but "Didsbury" counts as much as
      // "Manchester", so a missing city name alone doesn't fail it.
      s ? !!s.title && (english(i.business.countryCode) ? i.keywords.some((k) => title.includes(k)) || (!!city && title.includes(city)) : true) : null,
      s?.title ? `Title: "${s.title}"` : s ? "No page title" : null,
    ),
    c("site_meta", "Meta description", 5, s ? !!s.metaDescription : null, null),
    c("site_schema", "Business schema (structured data)", 5, s ? s.schema : null, null),
    c("site_tracking", "Analytics installed", 5, s ? s.analytics.length > 0 : null, s?.analytics.join(", ") || null),
    c("site_fresh", "Looks maintained (current copyright year)", 5, s ? (s.copyrightYear == null ? null : !stale) : null, s?.copyrightYear ? `Footer says © ${s.copyrightYear}` : null),
    c(
      "site_speed",
      s?.pageSpeed != null ? "Mobile PageSpeed 90+" : "Loads quickly",
      5,
      s ? fast : null,
      s?.pageSpeed != null ? `PageSpeed (mobile): ${s.pageSpeed}` : s?.loadMs != null ? `Homepage loaded in ${(s.loadMs / 1000).toFixed(1)} s, ${s.kb} KB` : null,
    ),
  ];
}

// ---------- Verdict, pattern, priority, talking points ----------

export const VERDICTS = {
  launch: { label: "Launch now", offer: "Golden Formula build and the 60-day program", expectation: "Leads within weeks" },
  launch_visibility: {
    label: "Launch + visibility",
    offer: "Build plus visibility fixes in the first 30 days: Google profile, listings, review drive",
    expectation: "Leads within 1 to 3 months",
  },
  visibility_first: {
    label: "Visibility first",
    offer: "Google profile, reviews and listings start immediately, alongside or before the build",
    expectation: "Months, not weeks. Say so up front",
  },
  on_the_call: {
    label: "Finish the audit on the call",
    offer: "Too many visibility checks are still open to pick a package. Run the audit live with their Google profile open",
    expectation: "Decide after the audit",
  },
  visibility_program: {
    label: "Visibility program",
    offer: "Keep their website: it already converts. Google profile, reviews, listings and map-pack work",
    expectation: "Results in 1 to 3 months",
  },
  corporate: {
    label: "Corporate account",
    offer: "Part of a chain: the person at the store can't buy. Note it for a corporate list instead of pitching the store",
    expectation: "Not a cold call",
  },
} as const;

// Keyword checks only work in English for now; elsewhere they're shown as "check it yourself".
const ENGLISH = new Set(["US", "CA", "GB", "UK", "AU", "NZ", "IE"]);
const english = (cc?: string | null) => !cc || ENGLISH.has(cc.toUpperCase());

function findings(i: AuditInputs, vis: Check[], conv: Check[], hasWebsite: boolean): Finding[] {
  const f: Finding[] = [];
  const v = (id: string) => vis.find((c) => c.id === id)!;
  const k = (id: string) => conv.find((c) => c.id === id)!;
  const g = i.google;
  const s = i.site;

  const b = i.business;
  const social = !b.website && b.socialUrl ? socialLabel(b.socialUrl).replace(" only", "") : null;
  if (!hasWebsite) {
    const page = s?.directory ? "a directory listing" : s?.socialOnly ? "a social page" : social ? `a ${social} page` : null;
    f.push({
      id: "no_site",
      severity: 3,
      say: page ? `Their only "website" is ${page}: nothing they own turns searches into calls.` : "No website: people who find them on Google have nowhere to go.",
      email: page ? `your website link goes to ${page} rather than a site of your own` : "{{business_name}} doesn't have its own website yet",
    });
  } else if (s?.error === "parked") {
    f.push({
      id: "site_down",
      severity: 3,
      say: "Their web address shows a parked-domain page: the website has lapsed. Anyone who looks them up finds nothing.",
      email: "your web address is showing a parked-domain page instead of your website",
    });
  } else if (s?.error === "down" && s.cause === "dns") {
    f.push({
      id: "site_down",
      severity: 3,
      say: "Their web address doesn't exist anymore: the domain has lapsed. Anyone who looks them up finds nothing.",
      email: "your web address isn't working right now",
    });
  } else if (s?.error === "down") {
    f.push({
      id: "site_down",
      severity: 2,
      say: "Their website didn't load when we checked (we tried every address). Open it before the call to confirm it's down.",
      email: "your website wasn't loading when I checked",
    });
  }
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  };
  if (b.unlinkedSite && b.website && g.found)
    f.push({
      id: "unlinked_site",
      severity: 3,
      say: `They have a website (${host(b.website)}), but their Google profile doesn't link it: people who find them on Maps never see it. Quick win.`,
      email: `your website (${host(b.website)}) isn't linked from your Google listing`,
    });
  if (b.possibleSite)
    f.push({
      id: "possible_site",
      severity: 2,
      say: `There may be a website at ${host(b.possibleSite)} (we couldn't confirm it's theirs). Ask on the call.`,
      email: "",
    });
  if (g.checked && !g.found) f.push({ id: "no_gbp", severity: 3, say: "No Google Business Profile found: invisible on Google Maps.", email: "{{business_name}} doesn't show up on Google Maps" });
  if (v("map_pack").state === "fail" && g.found && g.rankQuery)
    f.push({
      id: "map_pack",
      severity: g.rank && g.rank <= 10 ? 2 : 3,
      say: `${g.rank ? `#${g.rank}` : "Not in the top 20"} on Google Maps for "${g.rankQuery}". The top 3 get most of the calls.`,
      email: g.rank ? `you're #${g.rank} on Google Maps for "${g.rankQuery}", just outside the top 3` : `you don't show up on Google Maps when I search "${g.rankQuery}"`,
    });
  if (v("gbp_reviews").state === "fail" && g.found)
    f.push({
      id: "reviews",
      severity: (g.reviewCount ?? 0) < 10 ? 3 : 2,
      say: `${g.reviewCount ?? 0} Google reviews${g.rating ? ` at ${g.rating.toFixed(1)}★` : ""}. Target is 20+ at 4.5★: a review drive is a quick win.`,
      email: g.reviewCount ? `you have ${g.reviewCount} Google reviews, and a few more would lift you on Maps` : "you don't have any Google reviews yet",
    });
  if (hasWebsite && s?.reachable) {
    if (k("site_call").state === "fail") f.push({ id: "no_call", severity: 3, say: "Phone number isn't tappable: mobile visitors can't call in one tap.", email: "your phone number isn't tappable on mobile, so visitors can't call you in one tap" });
    if (k("site_mobile").state === "fail") f.push({ id: "no_mobile", severity: 3, say: "Site isn't built for phones (no mobile viewport).", email: "your site isn't set up for phones" });
    if (k("site_form").state === "fail") f.push({ id: "no_form", severity: 2, say: "No quote form, booking or ordering on the homepage or contact page.", email: "there's no quick way to request a quote or order on your website" });
    if (k("site_reviews").state === "fail" && (g.reviewCount ?? 0) >= 5)
      f.push({ id: "reviews_hidden", severity: 2, say: `They have ${g.reviewCount} Google reviews but none on the website.`, email: `your ${g.reviewCount} Google reviews aren't shown anywhere on your website` });
    if (k("site_fresh").state === "fail") f.push({ id: "stale", severity: 2, say: `Footer says © ${s.copyrightYear}: the site looks unmaintained.`, email: `your site's footer still says © ${s.copyrightYear}` });
    if (k("site_title").state === "fail") f.push({ id: "title", severity: 1, say: `Page title doesn't say service + city${s.title ? ` ("${s.title}")` : ""}.`, email: "your homepage title doesn't mention what you do or where" });
    if (k("site_speed").state === "fail") f.push({ id: "slow", severity: 1, say: `${k("site_speed").evidence}.`, email: "your homepage is slow to load on mobile" });
    if (k("site_tracking").state === "fail") f.push({ id: "no_tracking", severity: 1, say: "No analytics: they can't tell how many leads the site brings.", email: "you have no way to see how many customers your website brings in" });
  }
  const d = g.deep;
  if (g.found && d) {
    if (d.newestReviewDays != null && d.newestReviewDays > 180)
      f.push({
        id: "stale_reviews",
        severity: 2,
        say: `Their newest Google review is from ${ago(d.newestReviewDays)}: the profile looks inactive, which costs them Maps ranking.`,
        email: `your newest Google review is from ${ago(d.newestReviewDays)}`,
      });
    if (!d.hours) f.push({ id: "no_hours", severity: 2, say: "No opening hours on their Google profile: people can't tell if they're open.", email: "your Google profile doesn't show opening hours" });
    if (d.photos < 5)
      f.push({
        id: "few_photos",
        severity: 1,
        say: `${d.photos === 0 ? "No" : `Only ${d.photos}`} photo${d.photos === 1 ? "" : "s"} on their Google profile. Profiles with photos get far more calls and direction requests.`,
        email: `your Google profile has ${d.photos === 0 ? "no" : `only ${d.photos}`} photo${d.photos === 1 ? "" : "s"}`,
      });
  }
  if (v("nap").state === "fail") f.push({ id: "nap", severity: 1, say: v("nap").evidence ?? "Phone differs between website and listing.", email: "the phone number on your website doesn't match your Google listing" });
  if (v("name_says").state === "fail") f.push({ id: "name", severity: 1, say: "Name doesn't say what they do: the profile and site need to carry the service keywords.", email: "your business name doesn't tell Google what you do" });
  return f.sort((a, b) => b.severity - a.severity);
}

export function scoreAudit(inputs: AuditInputs, manual: ManualAnswers = {}): AuditResult {
  const { business: b, site, google: g } = inputs;
  const hasWebsite = !!b.website && !!site && !site.socialOnly && !site.directory;

  const vis = visibility(inputs).map((c) => {
    const m = manual.checks?.[c.id];
    return m ? { ...c, state: m, method: "manual" as Method, overridden: true } : c;
  });
  const visScore = vis.reduce((n, c) => n + (c.state === "pass" ? c.points : 0), 0);
  const open = vis.reduce((n, c) => n + (c.state === "unknown" ? c.points : 0), 0);

  const conv = conversion(inputs);
  const decided = conv.filter((c) => c.state !== "unknown");
  const siteDown = hasWebsite && (site?.error === "down" || site?.error === "parked");
  const blocked = hasWebsite && !site?.reachable && !siteDown;
  // No site or a dead site converts nobody: a real 0. A site that blocked our check is simply unmeasured.
  const measured = hasWebsite && !!site?.reachable;
  const convScore = measured
    ? Math.round((decided.reduce((n, c) => n + (c.state === "pass" ? c.points : 0), 0) / Math.max(1, decided.reduce((n, c) => n + c.points, 0))) * 100)
    : 0;
  const BLOCKED_NOTE: Record<string, string> = {
    timeout: "Site didn't answer in time (we tried every address): open it yourself",
    tls: "Site's security certificate failed for us: browsers may show a warning. Open it yourself",
    reset: "Site dropped our connection: open it yourself",
  };
  const convNote = !hasWebsite
    ? site?.directory
      ? "Website link goes to a directory listing"
      : site?.socialOnly
        ? "Website link goes to a social page"
        : b.socialUrl
          ? `No website of their own: only a ${socialLabel(b.socialUrl).replace(" only", "")} page`
          : "No website of their own"
    : siteDown
      ? site?.error === "parked"
        ? "Domain is parked: the website has lapsed"
        : site?.cause === "dns"
          ? "Domain doesn't resolve: the website has lapsed"
          : "Website didn't load on any address"
      : blocked
        ? site?.error === "script"
          ? "Site is drawn by JavaScript, so it needs a browser to check: open it on your phone"
          : (BLOCKED_NOTE[site?.cause ?? ""] ?? "Site blocked our check: open it yourself")
        : null;
  const demandKnown = g.found && g.reviewCount != null;
  // "Call first" needs proof of real demand: the playbook's fit is "real reviews somewhere".
  const DEMAND_MIN = 5;
  const demandOk = demandKnown && (g.reviewCount ?? 0) >= DEMAND_MIN;

  // Two needs, each 0-1, on what we could check (unchecked points are neither strengths nor gaps).
  //   website:    no site / dead / parked / social only = 1; measured = what the site loses; couldn't check = 0.4
  //   visibility: checked points projected to 20; each lost point adds need (8/20 or less = all need)
  const visChecked = 20 - open;
  const websiteNeed = !hasWebsite || siteDown ? 1 : measured ? (100 - convScore) / 100 : 0.4;
  const visibilityNeed = !g.checked || visChecked < 4 ? 0.5 : Math.max(0, Math.min(1, (20 - (20 * visScore) / visChecked) / 12));
  const HIGH = 0.4;
  const chain = b.chainReason ?? (b.chain ? "Part of a chain: several locations with this name" : null);
  const pitchKey: PitchKey = chain
    ? "corporate"
    : websiteNeed >= HIGH && visibilityNeed >= HIGH
      ? "both"
      : websiteNeed >= HIGH
        ? "website"
        : visibilityNeed >= HIGH
          ? "visibility"
          : "solid";

  // Verdict: the package to pitch. A site that already converts never gets a rebuild; no site or a
  // dead one always needs the build. Otherwise the playbook's stage-3 thresholds on visibility, and
  // with 10+ points unanswered the score can't pick a package yet: finish it on the call.
  const vKey: keyof typeof VERDICTS = chain
    ? "corporate"
    : measured && convScore >= 80
      ? "visibility_program"
      : !hasWebsite || siteDown
        ? visScore >= 14
          ? "launch"
          : "launch_visibility"
        : visScore >= 14
          ? "launch"
          : open >= 10 && visScore + open >= 8
            ? "on_the_call"
            : visScore >= 8
              ? "launch_visibility"
              : "visibility_first";
  const verdict = { key: vKey, ...VERDICTS[vKey], provisional: open > 0 } as AuditResult["verdict"];

  // Pattern: which side of Leads = Visibility × Conversion is holding them back.
  const vHigh = visScore >= 10 || (g.reviewCount ?? 0) >= 30;
  const vLow = visScore < 8 && (g.reviewCount ?? 0) < 20;
  let pattern: AuditResult["pattern"];
  if (!g.checked) {
    // Without Google data we only know the website side. Don't guess the visibility side.
    const confirm = "Check their Google profile and reviews on the call to confirm the pitch.";
    if (!hasWebsite) pattern = { key: "no_site", label: "No website", explain: `Nothing of their own turns searches into calls. If people already find them on Google, this is a quick win. ${confirm}` };
    else if (siteDown) pattern = { key: "site_down", label: "Website down", explain: `Their site doesn't load, so anyone who looks them up bounces. Urgent and easy to explain. ${confirm}` };
    else if (blocked) pattern = { key: "unmeasured", label: "Website not checked", explain: `The site blocked our automatic check. Open it on your phone before the call. ${confirm}` };
    else if (convScore < 60) pattern = { key: "weak_site", label: "Weak website", explain: `The site loses customers who find it. If their Google profile is strong, this is the Rubio pattern. ${confirm}` };
    else pattern = { key: "decent_site", label: "Decent website", explain: `The site is in reasonable shape. If they still get few leads, visibility is the weak side (Kilowash pattern). ${confirm}` };
  } else if (!hasWebsite || siteDown)
    pattern = vHigh || (g.reviewCount ?? 0) >= 10
      ? {
          key: "demand_no_site",
          label: siteDown ? "Demand, website down" : "Demand, no website",
          explain: `People already find and review them, but ${siteDown ? "their site doesn't load" : "there's no site"} to turn that into calls. Rubio's story: fix conversion and leads follow fast.`,
        }
      : { key: "from_zero", label: "Starting from zero", explain: "Little visibility and no website. Visibility first, alongside the build. Set expectations: months, not weeks." };
  else if (blocked)
    pattern = { key: "unmeasured", label: "Website not checked", explain: "The site blocked our automatic check, so only the visibility side is scored. Open the site on your phone before the call." };
  else if (vHigh && convScore < 60)
    pattern = { key: "rubio", label: "Rubio pattern", explain: "Strong visibility, weak conversion. Customers find them; the site doesn't make them call. A Golden Formula build is the lever." };
  else if (vLow && convScore >= 60)
    pattern = { key: "kilowash", label: "Kilowash pattern", explain: "Decent site, almost no visibility. Nobody finds it. Fix the Google profile, reviews and listings first." };
  else if (vLow)
    pattern = { key: "both_weak", label: "Both sides weak", explain: "Low visibility and a weak site. Visibility first, build alongside it." };
  else if (convScore >= 75)
    pattern = { key: "solid", label: "Already solid", explain: "Both sides are in decent shape. Lower priority: pitch the monthly program or specific fixes." };
  else pattern = { key: "mixed", label: "Fix the weaker side", explain: convScore < 60 ? "Visibility is okay; the website is the weaker side." : "The website is okay; visibility is the weaker side." };

  // Priority: how worth a call this lead is for Bould (0-100). Demand (reviews), plus the stronger
  // need with a little of the other: a good site with a weak profile ranks beside a lead with no site.
  const reviews = g.reviewCount;
  const demand = reviews != null ? Math.min(35, 17.5 * Math.log10(1 + reviews)) : hasWebsite ? 15 : 8;
  const need = 30 * Math.max(websiteNeed, visibilityNeed) + 10 * Math.min(websiteNeed, visibilityNeed);
  const reach = (b.phone ? 7 : 0) + (b.status === "verified" ? 8 : b.email ? 4 : 0);
  const quality = g.rating == null ? 5 : g.rating >= 4 ? 10 : g.rating >= 3.5 ? 5 : 0;
  let priority = Math.round(demand + need + reach + quality);
  if (pitchKey === "solid") priority -= 15;
  if (g.status === "CLOSED_TEMPORARILY") priority -= 25;
  // Chains sink to the bottom of every list sorted by priority, not just to tier C.
  if (chain) priority = Math.min(priority, 25);
  priority = Math.max(0, Math.min(100, priority));

  let tier: AuditResult["tier"] = priority >= 65 ? "A" : priority >= 45 ? "B" : "C";
  let tierReason = `Priority ${priority}/100`;
  if (tier === "A" && !demandOk) {
    tier = "B";
    tierReason += g.checked ? `, capped at B: fewer than ${DEMAND_MIN} Google reviews` : ", capped at B until Google confirms demand (add a key in Settings)";
  }
  if (chain) [tier, tierReason] = ["C", `Corporate: ${chain}. The store can't buy; kept out of the call list's top`];
  if (b.nonFit) [tier, tierReason] = ["not_fit", b.nonFit];
  if (g.status === "CLOSED_PERMANENTLY") [tier, tierReason] = ["not_fit", "Permanently closed on Google"];
  else if (!b.phone && !b.email && !measured) [tier, tierReason] = ["not_fit", "No phone, email or working website to reach them"];
  else if (g.checked && !g.found && !hasWebsite) [tier, tierReason] = ["not_fit", "No Google profile and no website: may not be an active business"];
  // Not a fit sinks to the bottom of every list sorted by priority, like chains.
  if (tier === "not_fit") priority = Math.min(priority, 10);

  return {
    version: 1,
    visibility: { score: visScore, max: 20, open, checks: vis },
    conversion: { score: convScore, hasWebsite, measured, note: convNote, checks: conv },
    verdict,
    pattern,
    pitch: { key: pitchKey, label: PITCHES[pitchKey] },
    needs: { website: Math.round(websiteNeed * 100) / 100, visibility: Math.round(visibilityNeed * 100) / 100 },
    site: siteState(b, site),
    priority,
    tier,
    tierReason,
    findings: findings(inputs, vis, conv, hasWebsite),
    inputs,
  };
}

/** Words that describe a business type, for "name says what they do" and title checks. */
const GENERIC = new Set(["shop", "shops", "store", "stores", "service", "services", "and", "the", "of", "other", "business", "businesses", "local", "center", "centre"]);
export function keywordsFor(labels: (string | null | undefined)[], extra: string[] = []): string[] {
  const out = new Set<string>();
  for (const l of [...labels, ...extra]) {
    if (!l) continue;
    for (const w of norm(l).split(/[^a-z0-9]+/)) {
      if (w.length < 3 || GENERIC.has(w)) continue;
      out.add(w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w); // "dentists" → "dentist"
    }
  }
  return [...out];
}
