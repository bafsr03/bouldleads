import * as cheerio from "cheerio";
import { robotsAllows } from "../enrich/crawl";
import { fetchWithTimeout } from "../discovery/http";

// Website facts for the conversion side of the audit: "when customers find the business, do they call?"
// One polite request to the homepage (robots.txt respected). Everything here is measured, not guessed.

export type SiteFacts = {
  reachable: boolean;
  // Why it didn't load: "down" = DNS/connection failure or 5xx (the business's problem, worth raising);
  // "blocked" = the site refused our bot (403/429, robots.txt). We can't judge it, so it isn't scored.
  // "parked" = the domain shows a registrar/parking page (lapsed or for sale).
  // "script" = the page is drawn by JavaScript, so its raw HTML is nearly empty: we can't judge it
  // without a browser, and it isn't scored (rather than wrongly called "weak").
  error: "down" | "parked" | "blocked" | "script" | null;
  // Why, in more detail. Only "dns" (the domain doesn't resolve) backs "the domain may have lapsed".
  //   down:    dns · refused (nothing answers) · server (5xx on every address)
  //   blocked: timeout · tls (certificate problem) · reset · challenge (bot wall) · http (4xx) · robots · type (not HTML)
  cause?: SiteCause | null;
  socialOnly: boolean; // the "website" is a Facebook/Instagram/Linktree page
  directory?: boolean; // the "website" is a directory listing (Yelp, BBB, usmap…), not a site of their own
  url: string | null;
  https: boolean;
  loadMs: number | null;
  kb: number | null;
  title: string | null;
  metaDescription: string | null;
  viewport: boolean;
  tapToCall: boolean; // tel: link
  whatsapp: boolean;
  phoneInHeader: boolean;
  phones: string[]; // digits only, for NAP comparison
  form: boolean;
  formMaybe: boolean; // a quote/contact link exists but no readable form (often drawn by JavaScript): check by hand
  booking: string | null; // online booking / ordering provider, or a clear "Book" link
  ctas: string[];
  reviewsOnSite: boolean;
  schema: boolean; // LocalBusiness-style structured data
  analytics: string[];
  copyrightYear: number | null;
  platform: string | null;
  ecommerce: boolean;
  profiles: string[]; // directories & social profiles linked from the site
  images: number;
  imagesNoAlt: number;
  pageSpeed: number | null; // Google PageSpeed mobile performance 0-100, when enabled
  contactPage: string | null; // contact page we also checked (form / tap-to-call found there count)
  textChars: number; // visible text on the homepage, to spot JavaScript-only pages
};

export type SiteCause = "dns" | "refused" | "server" | "timeout" | "tls" | "reset" | "challenge" | "http" | "robots" | "type";

const SOCIAL_ONLY = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|tiktok\.com|wa\.me|whatsapp\.com|beacons\.ai|linkin\.bio)$/i;
// Directory and listing pages given as the website: a listing, not a site they own.
export const DIRECTORY_HOST =
  /(^|\.)(yelp\.com|yellowpages\.com|manta\.com|bbb\.org|mapquest\.com|nextdoor\.com|angi\.com|homeadvisor\.com|thumbtack\.com|houzz\.com|porch\.com|buildzoom\.com|chamberofcommerce\.com|bizapedia\.com|usmap[a-z0-9-]*\.(org|com|net))$/i;

const PLATFORMS: [string, RegExp][] = [
  ["Shopify", /cdn\.shopify\.com|Shopify\.theme/i],
  ["Wix", /static\.wixstatic\.com|wix-code|_wixCIDX/i],
  ["Squarespace", /static1\.squarespace\.com|squarespace-cdn/i],
  ["Webflow", /data-wf-site|webflow\.js/i],
  ["GoDaddy Website Builder", /img1\.wsimg\.com|godaddy\.com\/websites/i],
  ["Square Online", /editmysite\.com|square\.site/i],
  ["Weebly", /weebly\.com|editmysite/i],
  ["Duda", /multiscreensite\.com|dudaone/i],
  ["Google Sites", /sites\.google\.com|business\.site/i],
  ["Jimdo", /jimdo/i],
  ["WordPress", /wp-content|wp-includes/i],
];

const BOOKING: [string, RegExp][] = [
  ["Calendly", /calendly\.com/i],
  ["Square Appointments", /squareup\.com\/appointments|square\.site\/book/i],
  ["Booksy", /booksy\.com/i],
  ["Vagaro", /vagaro\.com/i],
  ["Fresha", /fresha\.com/i],
  ["Acuity", /acuityscheduling\.com/i],
  ["Housecall Pro", /housecallpro\.com/i],
  ["Jobber", /getjobber\.com|jobber\.com/i],
  ["ServiceTitan", /servicetitan/i],
  ["OpenTable", /opentable\.com/i],
  ["Resy", /resy\.com/i],
  ["Toast", /toasttab\.com/i],
  ["DoorDash", /doordash\.com/i],
  ["Uber Eats", /ubereats\.com/i],
  ["Rappi", /rappi\./i],
];

const PROFILES: [string, RegExp][] = [
  ["Google Maps", /(maps\.google\.|google\.[a-z.]+\/maps|g\.page\/|goo\.gl\/maps|maps\.app\.goo\.gl)/i],
  ["Facebook", /facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)/i],
  ["Instagram", /instagram\.com\/(?!p\/)/i],
  ["Yelp", /yelp\.[a-z.]+\/biz/i],
  ["BBB", /bbb\.org/i],
  ["Angi", /angi\.com|angieslist\.com/i],
  ["Nextdoor", /nextdoor\.com/i],
  ["Tripadvisor", /tripadvisor\./i],
  ["Apple Maps", /maps\.apple\.com/i],
  ["TikTok", /tiktok\.com\/@/i],
  ["YouTube", /youtube\.com\/(c\/|channel\/|@|user\/)/i],
  ["LinkedIn", /linkedin\.com\/company/i],
  ["X / Twitter", /\/\/(www\.)?(twitter|x)\.com\/(?!share|intent)[A-Za-z0-9_]+/i],
];

const CTA = [
  "call now", "call us", "call today", "get a quote", "free quote", "free estimate", "request a quote", "get an estimate",
  "book now", "book online", "book an appointment", "schedule", "order online", "order now", "shop now", "get directions",
  "llámanos", "llama ahora", "cotiza", "cotización", "presupuesto", "reserva", "agenda tu", "pide", "compra ahora",
  "ligue", "orçamento", "agende",
];

const REVIEWS =
  /testimonial|(customer|client|patient|our|google|read (our|more)) reviews|reviews from|what (our )?(customers|clients|patients|people) (say|are saying)|★★★★|5[- ]star reviews|reseñas|testimonios|opiniones|depoimentos|avis clients|elfsight|trustindex|birdeye|podium|yotpo|judge\.me|stamped\.io|reviewsonmywebsite|trustpilot|feefo|doctify|reviews\.io|reviews\.co\.uk|nicejob|grade\.us|embedsocial|widget\.reviews/i;

// Form tools that inject the form with JavaScript: their script on the page means there is a form.
const FORM_TOOLS =
  /hsforms|hbspt\.forms|js\.hsforms\.net|jotform|jotfor\.ms|typeform|leadconnectorhq|msgsndr|wpforms|gravityforms|gform_|formstack|cognitoforms|formspree|tally\.so|fillout|ninja-forms|wpcf7|fluentform|elementor-form|wufoo|paperform|123formbuilder/i;

// A link that books or schedules: counts as a way to convert even when the booking lives elsewhere.
const BOOK_TEXT =
  /\b(book|schedule|request)\b[^<]{0,25}\b(appointment|online|now|consultation|visit|estimate|inspection|a call|a table)\b|book now|reservar|agendar|pedir cita|cita online|prenota|prendre rendez-vous|termin buchen/i;
const BOOK_HREF = /(book|booking|appointment|schedul|portal\.dental|dentally|calendly|acuityscheduling|setmore|zocdoc|opentable|resy\.com|vagaro|fresha|booksy|squareup\.com\/appointments|housecallpro|jobber|servicetitan|simplybook)/i;
const QUOTE_LINK = /quote|estimate|contact|cotiza|presupuesto|contacto|orçamento|devis|kontakt|preventivo/i;

const phoneDigits = (s: string) => s.replace(/\D/g, "");
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,16}\d)/g;

export function analyzeHtml(html: string, finalUrl: string): Omit<SiteFacts, "reachable" | "error" | "socialOnly" | "loadMs" | "pageSpeed" | "contactPage"> {
  const $ = cheerio.load(html);
  const url = new URL(finalUrl);
  const links = $("a[href]")
    .map((_, a) => $(a).attr("href") ?? "")
    .get();
  const text = $("body").text().replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  const header = $("header, nav, [class*=header], [id*=header], [class*=topbar], [class*=top-bar]").first();
  const headerHtml = header.length ? $.html(header) : "";
  const headerText = header.length ? header.text() : text.slice(0, 600);

  const tels = links.filter((h) => /^tel:/i.test(h)).map((h) => phoneDigits(h));
  const textPhones = (text.match(PHONE_RE) ?? []).map(phoneDigits).filter((d) => d.length >= 8 && d.length <= 15);

  let schema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (/"@type"\s*:\s*\[?\s*"[^"]*(LocalBusiness|Store|Shop|Restaurant|Dentist|Contractor|Service|Salon|Physician|Clinic|AutoRepair|Plumber|Electrician|Organization)/i.test(raw) || /"address"\s*:/.test(raw))
      schema = true;
  });

  const years = [...text.matchAll(/(?:©|copyright|\(c\))\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));

  const forms = $("form").filter((_, f) => {
    const fields = $(f).find("input, textarea, select");
    const isSearch = $(f).attr("role") === "search" || $(f).find('input[type="search"], input[name="s"], input[name="q"]').length > 0;
    const isNewsletter = fields.length <= 2 && $(f).find('input[type="email"]').length === 1 && !$(f).find("textarea").length;
    return fields.length >= 2 && !isSearch && !isNewsletter;
  }).length;

  const imgs = $("img");
  const analytics = [
    /googletagmanager\.com|gtag\(|google-analytics\.com/i.test(html) && "Google Analytics/Tag Manager",
    /connect\.facebook\.net|fbq\(/i.test(html) && "Meta Pixel",
    /clarity\.ms/i.test(html) && "Microsoft Clarity",
    /hotjar/i.test(html) && "Hotjar",
    /plausible\.io/i.test(html) && "Plausible",
  ].filter((x): x is string => !!x);

  const platform = PLATFORMS.find(([, re]) => re.test(html))?.[0] ?? null;
  const allLinks = links.join(" ");
  const formTool = FORM_TOOLS.test(html);
  let bookingLink = false;
  let quoteLink = false;
  $("a[href], button").each((_, el) => {
    const label = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href") ?? "";
    if (BOOK_TEXT.test(label) || (BOOK_HREF.test(href) && /^https?:|^\//.test(href) && label.length > 0)) bookingLink = true;
    if (QUOTE_LINK.test(href) || QUOTE_LINK.test(label)) quoteLink = true;
  });

  return {
    url: url.toString(),
    https: url.protocol === "https:",
    kb: Math.round(Buffer.byteLength(html) / 1024),
    title: $("title").first().text().trim().slice(0, 200) || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim().slice(0, 300) || null,
    viewport: $('meta[name="viewport"]').length > 0,
    tapToCall: tels.length > 0,
    whatsapp: /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(allLinks),
    phoneInHeader: /href="tel:/i.test(headerHtml) || new RegExp(PHONE_RE.source).test(headerText),
    phones: [...new Set([...tels, ...textPhones])].slice(0, 10),
    form: forms > 0 || formTool,
    formMaybe: forms === 0 && !formTool && quoteLink,
    booking: BOOKING.find(([, re]) => re.test(html))?.[0] ?? (bookingLink ? "Online booking link" : null),
    ctas: CTA.filter((c) => lower.includes(c)).slice(0, 6),
    reviewsOnSite: REVIEWS.test(html),
    schema,
    analytics,
    copyrightYear: years.length ? Math.max(...years) : null,
    platform,
    ecommerce:
      platform === "Shopify" || platform === "Square Online" || /woocommerce|add to cart|add-to-cart|añadir al carrito|agregar al carrito|\/cart\b|\/carrito/i.test(html),
    profiles: PROFILES.filter(([, re]) => re.test(allLinks)).map(([name]) => name),
    images: imgs.length,
    imagesNoAlt: imgs.filter((_, i) => !($(i).attr("alt") ?? "").trim()).length,
    textChars: text.trim().length,
  };
}

/** A page whose content only appears once JavaScript runs (React/Vue apps, some builders). */
export function isScriptOnly(html: string, textChars: number): boolean {
  if (textChars >= 250) return false;
  return /<div[^>]+id=["'](root|app|__next|__nuxt|svelte)["']|<script[^>]+src=["'][^"']*(chunk|bundle|main\.[a-f0-9]+|app\.[a-f0-9]+)[^"']*\.js/i.test(html) || /<noscript>[^<]*(enable|activa|ative)[^<]*javascript/i.test(html);
}

const CONTACT_WORDS = /contact|contacto|contáctanos|contactenos|contato|kontakt|contatti|nous-contacter/i;

/** The site's contact page: a link that says "contact", else /contact on the same host. */
export function contactUrl(html: string, finalUrl: string): string | null {
  const $ = cheerio.load(html);
  const base = new URL(finalUrl);
  let found: string | null = null;
  $("a[href]").each((_, a) => {
    if (found) return;
    const href = $(a).attr("href") ?? "";
    if (!CONTACT_WORDS.test(href) && !CONTACT_WORDS.test($(a).text())) return;
    try {
      const u = new URL(href, base);
      if (u.hostname === base.hostname && /^https?:$/.test(u.protocol) && u.pathname !== base.pathname) found = u.toString().split("#")[0];
    } catch {}
  });
  return found ?? new URL("/contact", base).toString();
}

async function pageSpeed(url: string, key: string | undefined): Promise<number | null> {
  // The Places key works if "PageSpeed Insights API" is enabled on it; otherwise fall back to keyless (rate-limited).
  return (key ? await pageSpeedOnce(url, key) : null) ?? (await pageSpeedOnce(url, undefined));
}

async function pageSpeedOnce(url: string, key: string | undefined): Promise<number | null> {
  const qs = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (key) qs.set("key", key);
  try {
    const res = await fetchWithTimeout(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { timeoutMs: 90000 });
    if (!res.ok) return null;
    const j = (await res.json()) as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
    const s = j.lighthouseResult?.categories?.performance?.score;
    return typeof s === "number" ? Math.round(s * 100) : null;
  } catch {
    return null;
  }
}

const EMPTY: Omit<SiteFacts, "reachable" | "error" | "socialOnly" | "url"> = {
  https: false,
  loadMs: null,
  kb: null,
  title: null,
  metaDescription: null,
  viewport: false,
  tapToCall: false,
  whatsapp: false,
  phoneInHeader: false,
  phones: [],
  form: false,
  formMaybe: false,
  booking: null,
  ctas: [],
  reviewsOnSite: false,
  schema: false,
  analytics: [],
  copyrightYear: null,
  platform: null,
  ecommerce: false,
  profiles: [],
  images: 0,
  imagesNoAlt: 0,
  pageSpeed: null,
  contactPage: null,
  textChars: 0,
};

const MAX_BYTES = 1_500_000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Fetched = { ok: true; html: string; finalUrl: string } | { ok: false; error: "down" | "parked" | "blocked"; cause: SiteCause | null };

// Parked, expired or never-connected domains: the website has lapsed.
export const PARKED =
  /domain (name )?(is|may be) for sale|buy this domain|this domain (has expired|is parked|is available)|parked (free|domain)|sedoparking|parkingcrew|bodis\.com|dan\.com\/buy|afternic|hugedomains|domain-for-sale|\/lander["']|godaddy\.com\/domainsearch|este dominio (está|esta) (a la venta|disponible)|dominio expirado|domain (isn['’]t|is not) connected to a (website|site)|reconnect your domain|connect (this|your) domain to (a|your) (wix )?site|website expired|this (website|site) has expired|this domain is not connected|squarespace[^<]{0,80}expired|site is (currently )?unavailable[^<]{0,40}(expired|suspended)|account (has been )?suspended/i;
// Bot walls (Cloudflare, Imperva, PerimeterX, Akamai): the site is up, it just won't talk to us.
const CHALLENGE = /<title>\s*(just a moment|attention required|access denied|please wait|one more step|security check)[^<]*<\/title>|cf-browser-verification|challenge-platform|_incapsula_resource|px-captcha|captcha-delivery\.com/i;

/** Map a failed fetch to what it tells us. Only a domain that doesn't resolve is clearly dead. */
export function classifyFetchError(e: unknown): { error: "down" | "blocked"; cause: SiteCause } {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string; message?: string } };
  const code = err?.cause?.code ?? err?.code ?? "";
  const name = err?.name ?? err?.cause?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError" || /TIMEOUT/i.test(code)) return { error: "blocked", cause: "timeout" };
  if (code === "ENOTFOUND" || code === "EAI_NODATA" || code === "EAI_NONAME") return { error: "down", cause: "dns" };
  if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") return { error: "down", cause: "refused" };
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|DEPTH_ZERO/i.test(code) || /certificate|ssl|tls/i.test(err?.cause?.message ?? ""))
    return { error: "blocked", cause: "tls" };
  return { error: "blocked", cause: "reset" }; // ECONNRESET, socket closed, EAI_AGAIN…: we couldn't tell
}

/** The other addresses a site might answer on: with/without www, https then http. */
export function addressVariants(url: string): string[] {
  const u = new URL(url);
  const bare = u.hostname.replace(/^www\./, "");
  const hosts = u.hostname.startsWith("www.") ? [u.hostname, bare] : [u.hostname, `www.${bare}`];
  const out: string[] = [];
  for (const proto of ["https:", "http:"]) for (const h of hosts) out.push(`${proto}//${h}/`);
  return out.filter((v) => v !== `${u.protocol}//${u.hostname}${u.pathname}`);
}

/** Tiny pages that only bounce the browser somewhere else (JS or meta refresh). */
function softRedirect(html: string, base: string): string | null {
  if (html.length > 3000) return null;
  const m =
    html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i) ??
    html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) ??
    html.match(/location\.replace\(\s*["']([^"']+)["']/i);
  if (!m) return null;
  try {
    return new URL(m[1].trim(), base).toString();
  } catch {
    return null;
  }
}

export async function fetchHome(url: string, timeoutMs = 15000): Promise<Fetched> {
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs,
      redirect: "follow",
      // A normal browser identity: many small-business sites sit behind firewalls that 403 anything
      // that looks like a bot. It's still one polite request per page, and robots.txt is respected.
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en;q=0.9,es;q=0.8,*;q=0.5" },
    });
    if (res.headers.get("cf-mitigated") === "challenge") return { ok: false, error: "blocked", cause: "challenge" };
    if (res.status >= 500) {
      // Cloudflare and friends answer bot checks with 503: that's a wall, not a dead site.
      const peek = res.body ? (await res.text().catch(() => "")).slice(0, 20_000) : "";
      return CHALLENGE.test(peek) ? { ok: false, error: "blocked", cause: "challenge" } : { ok: false, error: "down", cause: "server" };
    }
    if (!res.ok || !res.body) return { ok: false, error: "blocked", cause: res.status === 403 || res.status === 429 ? "challenge" : "http" }; // 403/429 bot walls, 401, odd 404s
    if (!(res.headers.get("content-type") ?? "").includes("html")) return { ok: false, error: "blocked", cause: "type" };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString("utf8");
    if (html.length < 60_000 && CHALLENGE.test(html)) return { ok: false, error: "blocked", cause: "challenge" };
    return { ok: true, html, finalUrl: res.url || url };
  } catch (e) {
    return { ok: false, ...classifyFetchError(e) };
  }
}

export async function checkSite(website: string, opts: { pageSpeed: boolean; googleKey?: string }): Promise<SiteFacts> {
  const host = new URL(website).hostname.replace(/^www\./, "");
  if (SOCIAL_ONLY.test(host)) return { ...EMPTY, reachable: true, error: null, socialOnly: true, url: website };
  if (DIRECTORY_HOST.test(host)) return { ...EMPTY, reachable: true, error: null, socialOnly: false, directory: true, url: website };

  const start = new URL(website);
  const allowed = await robotsAllows(start.origin);
  if (!allowed(start.pathname)) return { ...EMPTY, reachable: false, error: "blocked", cause: "robots", socialOnly: false, url: website };

  const t0 = Date.now();
  let page = await fetchHome(website);
  // The page the Google listing links to is what their customers see: retry it once before falling
  // back to the homepage (a deep link like /index.php/dealers can fail where the homepage works).
  if (!page.ok && start.pathname !== "/") {
    await new Promise((r) => setTimeout(r, 1500));
    page = await fetchHome(website);
    if (!page.ok) page = await fetchHome(start.origin + "/");
  }
  // "Their website is down" is a strong claim to make on a call. Before saying it (or "couldn't
  // check"), try the other addresses: a bare domain with a bad certificate often works on www, and
  // some small sites only answer on http. A timeout gets one other try, not four slow ones.
  if (!page.ok && page.cause !== "robots" && page.cause !== "http" && page.cause !== "type" && page.cause !== "challenge") {
    const first = page;
    const variants = addressVariants(website).slice(0, first.cause === "timeout" ? 1 : 4);
    for (const v of variants) {
      const next = await fetchHome(v, 10_000);
      if (next.ok) {
        page = next;
        break;
      }
      // Prefer the most telling failure: any sign of life (a timeout, a certificate) beats "doesn't resolve".
      if (page.ok === false && page.error === "down" && next.error === "blocked") page = next;
    }
    if (!page.ok && page.error === "down") {
      await new Promise((r) => setTimeout(r, 2500));
      const again = await fetchHome(start.origin + "/");
      if (again.ok || again.error === "blocked") page = again;
    }
  }
  const loadMs = Date.now() - t0;
  // Follow one JS/meta-refresh hop (common on cheap builders and parked domains).
  if (page.ok) {
    const next = softRedirect(page.html, page.finalUrl);
    if (next && !PARKED.test(page.html)) {
      const hop = await fetchHome(next);
      if (hop.ok) page = hop;
    }
  }
  if (page.ok && (PARKED.test(page.html) || /^\/lander\b/i.test(new URL(page.finalUrl).pathname))) page = { ok: false, error: "parked", cause: null };
  if (!page.ok) return { ...EMPTY, reachable: false, error: page.error, cause: page.cause, socialOnly: false, url: website };

  const facts = analyzeHtml(page.html, page.finalUrl);
  const finalHost = new URL(page.finalUrl).hostname.replace(/^www\./, "");
  if (DIRECTORY_HOST.test(finalHost)) return { ...EMPTY, reachable: true, error: null, socialOnly: false, directory: true, url: page.finalUrl };
  if (isScriptOnly(page.html, facts.textChars))
    return { ...EMPTY, reachable: false, error: "script", socialOnly: false, url: page.finalUrl, https: facts.https, loadMs, platform: facts.platform };

  // Homepage has no way to call or ask for a quote: check the contact page before saying so.
  let contactPage: string | null = null;
  if (!(facts.tapToCall || facts.whatsapp) || !(facts.form || facts.booking)) {
    const cu = contactUrl(page.html, page.finalUrl);
    const contact = cu && allowed(new URL(cu).pathname) ? await fetchHome(cu) : null;
    if (contact?.ok && !PARKED.test(contact.html)) {
      const c = analyzeHtml(contact.html, contact.finalUrl);
      if (!c.form && c.formMaybe) facts.formMaybe = true;
      if (c.form || c.tapToCall || c.whatsapp || c.booking) {
        contactPage = contact.finalUrl;
        facts.form ||= c.form;
        facts.formMaybe &&= !c.form;
        facts.tapToCall ||= c.tapToCall;
        facts.whatsapp ||= c.whatsapp;
        facts.booking ??= c.booking;
        facts.phones = [...new Set([...facts.phones, ...c.phones])].slice(0, 10);
      }
    }
  }
  return {
    ...facts,
    reachable: true,
    error: null,
    socialOnly: SOCIAL_ONLY.test(finalHost),
    loadMs,
    contactPage,
    pageSpeed: opts.pageSpeed ? await pageSpeed(page.finalUrl, opts.googleKey) : null,
  };
}

/** PageSpeed on its own, for the deep audit of top leads. */
export async function mobilePageSpeed(url: string, key: string | undefined): Promise<number | null> {
  return pageSpeed(url, key);
}
