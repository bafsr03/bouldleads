import * as cheerio from "cheerio";

// Pulls publicly published email addresses out of a web page and ranks them.

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;

const BAD_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|privacy|gdpr|dpo|webmaster|hostmaster|root|example|test|user|name|email|your)/i;
const BAD_DOMAIN =
  /(example\.(com|org|net)|domain\.com|email\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|godaddy\.com|squarespace\.com|shopify\.com|cloudflare\.com|w3\.org|schema\.org|yourdomain|mysite|sitename|png|jpe?g|gif|svg|webp|css|js)$/i;
const GOOD_LOCAL = /^(info|contact|hello|hi|office|admin|sales|enquiries|inquiries|enquiry|booking|bookings|reservations?|team|studio|shop|store|mail|kontakt|contacto|contato|bonjour|ciao|reception)$/i;
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|gmx|web|proton|protonmail|zoho|mail|yandex)\.[a-z.]+$/i;

/** Decode Cloudflare's email obfuscation (data-cfemail hex). */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Turn "info [at] acme [dot] com" / "info(at)acme.com" into real addresses. */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[[({<]\s*(?:at|@)\s*[\])}>]\s*/gi, "@")
    .replace(/\s+(?:at)\s+(?=[a-z0-9-]+\s*(?:[[({<]\s*)?(?:dot|\.)\s*)/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|\.)\s*[\])}>]\s*/gi, ".")
    .replace(/(@[a-z0-9-]+)\s+dot\s+(?=[a-z]{2,})/gi, "$1.");
}

export function cleanEmail(raw: string): string | null {
  let e = decodeURIComponent(raw.replace(/^mailto:/i, "").split("?")[0]).trim().toLowerCase();
  e = e.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const m = e.match(EMAIL_RE);
  if (!m || m[0] !== e) return null;
  const [local, domain] = e.split("@");
  if (BAD_LOCAL.test(local) || BAD_DOMAIN.test(domain)) return null;
  if (/\.(png|jpe?g|gif|svg|webp)$/i.test(e) || /@\d+x\./.test(e)) return null;
  if (/^[0-9a-f]{16,}$/.test(local)) return null; // tracking hashes
  return e;
}

export type Found = { email: string; source: string; viaMailto: boolean };

export function extractEmails(html: string, pageUrl: string): Found[] {
  const $ = cheerio.load(html);
  const found = new Map<string, Found>();
  const add = (raw: string, viaMailto: boolean) => {
    const e = cleanEmail(raw);
    if (e && !found.has(e)) found.set(e, { email: e, source: pageUrl, viaMailto });
    else if (e && viaMailto) found.get(e)!.viaMailto = true;
  };

  $('a[href^="mailto:" i]').each((_, el) => add($(el).attr("href") ?? "", true));
  $("[data-cfemail]").each((_, el) => add(decodeCfEmail($(el).attr("data-cfemail") ?? ""), false));
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const hex = ($(el).attr("href") ?? "").split("#")[1];
    if (hex) add(decodeCfEmail(hex), true);
  });

  $("script, style, noscript, svg").remove();
  const text = deobfuscate($("body").text().replace(/\s+/g, " "));
  for (const m of text.matchAll(EMAIL_RE)) add(m[0], false);
  // JSON-LD often carries "email": "..."
  for (const m of html.matchAll(/"email"\s*:\s*"(?:mailto:)?([^"]+)"/gi)) add(m[1], false);

  return [...found.values()];
}

/** Score 0-100: how likely this is the right business contact address. */
export function scoreEmail(email: string, siteDomain: string | null, viaMailto: boolean): number {
  const [local, domain] = email.split("@");
  const root = (d: string) => d.split(".").slice(-2).join(".");
  let score = 30;
  if (siteDomain && (domain === siteDomain || root(domain) === root(siteDomain))) score += 45;
  else if (FREE_MAIL.test(domain)) score += 10; // small businesses often use Gmail etc.
  else score -= 20; // some other company's domain (web agency, platform…)
  if (GOOD_LOCAL.test(local)) score += 15;
  else if (/^[a-z]+(\.[a-z]+)?$/.test(local)) score += 8; // firstname or first.last
  if (viaMailto) score += 10;
  if (/^(support|help|careers|jobs|hr|recruit|press|media|marketing|billing|accounts|invoice|events|catering)/.test(local)) score -= 15;
  // Departments that never route to the owner/decision-maker.
  if (/^(investor|ir$|wholesale|donation|donate|giving|sponsor|legal|accessibility|ada|compliance|vendor|supplier|purchasing|accounting|payroll|security|ethics)/.test(local))
    score -= 40;
  return Math.max(0, Math.min(100, score));
}

export function pickBest(found: Found[], siteDomain: string | null): (Found & { score: number }) | null {
  const ranked = found
    .map((f) => ({ ...f, score: scoreEmail(f.email, siteDomain, f.viaMailto) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

/** Same-site links that likely lead to contact info. */
export function contactLinks(html: string, pageUrl: string, max = 5): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const out = new Set<string>();
  const re = /(contact|kontakt|contacto|contato|contatti|about|ueber-uns|uber-uns|quienes|nosotros|impressum|imprint|legal|mentions|team|location|find-us|visit)/i;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const label = $(el).text();
    if (!re.test(href) && !re.test(label)) return;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return;
      if (!/^https?:$/.test(u.protocol) || /\.(pdf|jpe?g|png|zip|docx?)$/i.test(u.pathname)) return;
      u.hash = "";
      out.add(u.toString());
    } catch {
      /* ignore bad hrefs */
    }
  });
  // Contact pages first.
  return [...out].sort((a, b) => Number(/contact|kontakt|contacto|contato/i.test(b)) - Number(/contact|kontakt|contacto|contato/i.test(a))).slice(0, max);
}

export function siteSummary(html: string): string {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const desc =
    $('meta[name="description"]').attr("content")?.trim() ?? $('meta[property="og:description"]').attr("content")?.trim() ?? "";
  $("script, style, noscript, nav, footer, header").remove();
  const h1 = $("h1").first().text().trim();
  const body = $("main, body").first().text().replace(/\s+/g, " ").trim().slice(0, 400);
  return [title, h1, desc, body].filter(Boolean).join(" | ").slice(0, 900);
}
