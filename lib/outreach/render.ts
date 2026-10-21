// Template rendering: spintax {Hi|Hello} + merge tags {{business_name}} with fallbacks {{city|your area}}.
// Spintax choices are seeded per lead+step so the preview equals what gets sent.

export type MergeVars = {
  business_name: string;
  city?: string | null;
  category?: string | null;
  website?: string | null;
  domain?: string | null;
  sender_name?: string | null;
  company?: string | null;
  personal_line?: string | null;
  // From the lead audit (empty until the lead is audited; use a fallback: {{audit_issue|…}})
  audit_issue?: string | null;
  rating?: string | null;
  review_count?: string | null;
  map_rank?: string | null;
  search_term?: string | null;
  visibility_score?: string | null;
};

export const MERGE_TAGS: (keyof MergeVars)[] = [
  "business_name",
  "city",
  "category",
  "website",
  "domain",
  "sender_name",
  "company",
  "personal_line",
  "audit_issue",
  "rating",
  "review_count",
  "map_rank",
  "search_term",
  "visibility_score",
];

function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Resolve innermost {a|b|c} groups first. {{merge_tags}} (including {{city|fallback}}) are protected. */
export function spin(text: string, seed: string): string {
  const rand = seededRandom(seed);
  const tags: string[] = [];
  let out = text.replace(/\{\{[^{}]*\}\}/g, (m) => `\u0000${tags.push(m) - 1}\u0000`);
  const re = /\{([^{}]*\|[^{}]*)\}/;
  for (let guard = 0; guard < 500 && re.test(out); guard++) {
    out = out.replace(re, (_, body: string) => {
      const opts = body.split("|");
      return opts[Math.floor(rand() * opts.length)];
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => tags[Number(i)]);
}

export function merge(text: string, vars: MergeVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, key: string, fallback?: string) => {
    const v = vars[key.toLowerCase() as keyof MergeVars];
    const s = typeof v === "string" ? v.trim() : "";
    return s || (fallback ?? "").trim();
  });
}

export function render(template: string, vars: MergeVars, seed: string): string {
  // Spin before merging so business names containing "|" or braces can't be mangled.
  return merge(spin(template, seed), vars)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function footer(opts: { senderName: string; companyName: string; postalAddress: string; optOutLine: string }) {
  const company = [opts.companyName, opts.postalAddress].filter(Boolean).join(" · ");
  return `\n\n${opts.senderName}\n${company}\n\n${opts.optOutLine}`;
}

/** Simple, deliverability-friendly HTML version of the plain-text body. */
export function toHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
