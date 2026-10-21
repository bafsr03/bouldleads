import { fetchWithTimeout, USER_AGENT } from "../discovery/http";
import { contactLinks, extractEmails, pickBest, siteSummary, type Found } from "./extract-emails";

const MAX_BYTES = 1_500_000;
const MAX_PAGES = 6;

export async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 12000,
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "en;q=0.9,*;q=0.5" },
    });
    if (!res.ok || !res.body) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
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
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Minimal robots.txt check for the "*" group and our agent. */
export async function robotsAllows(origin: string): Promise<(path: string) => boolean> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, { timeoutMs: 6000 });
    if (!res.ok) return () => true;
    const lines = (await res.text()).split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
    const disallow: string[] = [];
    const allow: string[] = [];
    let applies = false;
    let lastWasAgent = false;
    const ourAgent = USER_AGENT.split("/")[0].toLowerCase();
    for (const line of lines) {
      const [k, ...rest] = line.split(":");
      const key = k?.toLowerCase();
      const val = rest.join(":").trim();
      if (key === "user-agent") {
        const ua = val.toLowerCase();
        applies = (lastWasAgent && applies) || ua === "*" || ua === ourAgent;
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!applies) continue;
      if (key === "disallow" && val) disallow.push(val);
      if (key === "allow" && val) allow.push(val);
    }
    return (path) => {
      const d = disallow.filter((p) => path.startsWith(p)).reduce((m, p) => Math.max(m, p.length), -1);
      const a = allow.filter((p) => path.startsWith(p)).reduce((m, p) => Math.max(m, p.length), -1);
      return d < 0 || a >= d;
    };
  } catch {
    return () => true;
  }
}

export type CrawlResult = {
  best: (Found & { score: number }) | null;
  all: Found[];
  summary: string | null;
  reachable: boolean;
};

export async function crawlForEmail(website: string, siteDomain: string | null): Promise<CrawlResult> {
  const start = new URL(website);
  const allowed = await robotsAllows(start.origin);
  if (!allowed(start.pathname)) return { best: null, all: [], summary: null, reachable: true };

  const home = await fetchHtml(website);
  if (!home) return { best: null, all: [], summary: null, reachable: false };

  const all = new Map<string, Found>();
  const collect = (list: Found[]) =>
    list.forEach((f) => {
      if (!all.has(f.email)) all.set(f.email, f);
    });
  collect(extractEmails(home.html, home.finalUrl));
  const summary = siteSummary(home.html);

  // Stop early if the homepage already exposes a strong on-domain address.
  let best = pickBest([...all.values()], siteDomain);
  if (!best || best.score < 80) {
    const links = contactLinks(home.html, home.finalUrl, MAX_PAGES - 1).filter((u) => allowed(new URL(u).pathname));
    // Fall back to the usual suspects if the nav didn't expose contact links.
    if (links.length === 0) {
      for (const p of ["/contact", "/contact-us", "/about", "/impressum"]) links.push(new URL(p, home.finalUrl).toString());
    }
    for (const link of links) {
      const page = await fetchHtml(link);
      if (!page) continue;
      collect(extractEmails(page.html, page.finalUrl));
      best = pickBest([...all.values()], siteDomain);
      if (best && best.score >= 85) break;
    }
  }
  return { best, all: [...all.values()], summary, reachable: true };
}
