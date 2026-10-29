// The top-3 check (Competitor Check spec v2, Oct 22 2026): where a lead ranks on Google Maps for
// "service in city", how it compares to the top 3, the one thing to fix, and who to call first.
// Pure functions only: lib/check/run-check.ts does the Google calls and saving.

export type Competitor = {
  id: string;
  name: string;
  rating: number | null;
  reviews: number | null;
  category: string | null; // Google's display name, e.g. "Concrete contractor"
  primaryType: string | null; // Google's type id, e.g. "concrete_contractor"
};

export type CaseKey = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export const CASES: Record<CaseKey, string> = {
  A: "Not on Google",
  B: "Wrong category",
  C: "Not showing near you",
  D: "Rating",
  E: "Reviews",
  F: "Close, other factors",
  G: "Already top 3",
};

export type LeadFacts = {
  placeId: string | null; // null = no Google profile found
  status: string | null; // businessStatus
  rating: number | null;
  reviews: number | null;
  category: string | null;
  primaryType: string | null;
};

export type Diagnosis = { case: CaseKey; title: string; say: string; gap: string | null };

export const RATING_TARGET = 4.5;

const fmt = (r: number) => r.toFixed(1);
const closed = (s: string | null) => s === "CLOSED_PERMANENTLY" || s === "CLOSED_TEMPORARILY";

/** 1-based position of the lead in the results, null = not in the top 20. */
export function rankOf(placeId: string | null, top: Pick<Competitor, "id">[]): number | null {
  if (!placeId) return null;
  const i = top.findIndex((c) => c.id === placeId);
  return i >= 0 ? i + 1 : null;
}

/** The category most of the top 3 are listed under (ties: the higher-ranked one). */
export function topCategory(top3: Competitor[]): { primaryType: string | null; category: string | null } {
  const counts = new Map<string, number>();
  for (const c of top3) if (c.primaryType) counts.set(c.primaryType, (counts.get(c.primaryType) ?? 0) + 1);
  let best: Competitor | null = null;
  for (const c of top3) if (c.primaryType && (!best || counts.get(c.primaryType)! > counts.get(best.primaryType!)!)) best = c;
  return { primaryType: best?.primaryType ?? null, category: best?.category ?? null };
}

/** The search without its city: "concrete contractor in Pleasant Grove" → "concrete contractor". */
export function serviceOf(query: string, city: string | null): string {
  let s = query.trim();
  if (city) {
    const re = new RegExp(`\\s+(in\\s+|near\\s+)?${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b.*$`, "i");
    s = s.replace(re, "");
  }
  return s.replace(/\s+(in|near)\s+[^ ].*$/i, "").trim() || query.trim();
}

/**
 * Spec §3.3: check in order, stop at the first that fails, show only that one. Case rules updated from
 * the Rochester, MN calls (Lead Sourcing & Scoring Improvements, Oct 28 2026 §4):
 *  - B only when the lead's category differs from all of the top 3 (and the search is for a trade
 *    the lead offers), for any lead outside the top 3.
 *  - E only when the review gap is real: under half of #3's reviews, or 10+ behind #3.
 *  - F says so when reviews are as strong as the top 3's: the gap is distance or relevance.
 *
 * Two readings of the earlier spec, flagged for Jake:
 *  - D (rating) applies only from #4 down. A #2 business at 4.3★ is already found, so it gets G,
 *    not "every top-3 business has 4.5 stars" (which would contradict them being in the top 3).
 *  - D only says "every top-3 business has 4.5 stars or higher" when that's true; otherwise it
 *    gives the top 3's actual ratings. The wording rules say always show real numbers.
 */
export function diagnose(lead: LeadFacts, top: Competitor[], query: string, city: string | null, opts: { offersService?: boolean } = {}): Diagnosis {
  const top3 = top.slice(0, 3);
  const rank = rankOf(lead.placeId, top);
  const service = serviceOf(query, city);
  const d = (k: CaseKey, say: string, gap: string | null = null): Diagnosis => ({ case: k, title: CASES[k], say, gap });

  if (!lead.placeId || closed(lead.status))
    return d("A", `You're not on Google Maps yet, so people searching for ${service} can't find you. That's step one.`, "No Google profile");

  if (rank != null && rank <= 3) return d("G", "You're already found. The question is whether your website turns those searches into calls.");

  // B: a clear mismatch only. Unknown categories don't count, and one top-3 business sharing the
  // lead's category (IBEW's #3) means the category isn't what's holding it back.
  const known = top3.filter((c) => c.primaryType);
  const tc = topCategory(top3);
  if (opts.offersService !== false && lead.primaryType && known.length > 0 && !known.some((c) => c.primaryType === lead.primaryType)) {
    const them = tc.category ?? tc.primaryType;
    const you = lead.category ?? lead.primaryType;
    return d(
      "B",
      rank == null
        ? `The top 3 are listed as ${them}. You're listed as ${you}, so Google doesn't show you for this search.`
        : `The top 3 are listed as ${them}. You're listed as ${you}, so Google ranks you lower for this search.`,
      `Category: ${you} → ${them}`,
    );
  }

  if (rank == null) return d("C", `You're not in the top 20 for "${query}" near you. Your profile needs work before anything else.`, "Not in the top 20");

  if (lead.rating != null && lead.rating < RATING_TARGET) {
    const ratings = top3.map((c) => c.rating).filter((r): r is number => r != null);
    const allHigh = ratings.length === top3.length && ratings.every((r) => r >= RATING_TARGET);
    const say = allHigh
      ? `Every top-3 business has ${RATING_TARGET} stars or higher. You're at ${fmt(lead.rating)}.`
      : `The top 3 are at ${ratings.map(fmt).join(", ")} stars. You're at ${fmt(lead.rating)}.`;
    return d("D", say, `${fmt(lead.rating)}★ → ${RATING_TARGET}★`);
  }

  const counts = top3.map((c) => c.reviews ?? 0);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const third = top3[top3.length - 1]?.reviews ?? min;
  const n = lead.reviews ?? 0;
  if (top3.length > 0 && reviewGap(n, third))
    return d(
      "E",
      `The top 3 have ${min === max ? min : `${min}–${max}`} reviews. You have ${n}. Getting to about ${third} is the gap.`,
      `${third - n} reviews to go (${n} → ${third})`,
    );

  if (top3.length > 0 && n >= max) return d("F", "Your reviews are strong. Reviews aren't what's holding you back.");
  return d("F", "Your reviews keep up. The gap is likely distance or your profile details. We'll look at it together.");
}

/** A review gap worth pitching: fewer than half of #3's reviews, or 10+ behind #3 (7 vs 8–10 isn't). */
export const reviewGap = (n: number, third: number) => n < third / 2 || third - n >= 10;

// ---------- Who to call first (Lead Sourcing & Scoring Improvements §6) ----------

/** `grade` is the website grade (site-grade.ts); null = no site of their own, or we couldn't read it. */
export type SiteFlags = {
  noSite: boolean;
  slowMobile: boolean;
  noCall: boolean;
  noForm: boolean;
  mobileScore: number | null;
  grade?: "Strong" | "OK" | "Weak" | null;
};

export const anyFlag = (f: SiteFlags) => f.noSite || f.slowMobile || f.noCall || f.noForm;

/** A weak or missing website. Before a site had a grade, any red flag counted. */
export const weakSite = (f: SiteFlags) => f.noSite || (f.grade ? f.grade === "Weak" : anyFlag(f));

/** 0 = "1+" (paying for marketing, still #4–20), 1 = call first … 4 = call last; SKIP = don't call. */
export const SKIP = 9;

export const PRIORITY_LABEL: Record<number, string> = {
  0: "Call first (1+): paying for marketing, still #4–20",
  1: "Call 1st: #4–20 with a clear gap",
  2: "Call 2nd: top 3, weak website",
  3: "Call 3rd: close, no clear gap",
  4: "Call last: not in the top 20, or not on Google",
  [SKIP]: "Skip",
};

export const PITCH: Record<number, string> = {
  0: "Here's what's holding you back. They already pay for marketing that isn't getting them into the top 3. (Growth plan)",
  1: "Here's what's holding you back. (Golden Formula)",
  2: "You're getting found and losing the calls. (Website Build)",
  3: "Dig in on the call.",
  4: "Most work to fix.",
  [SKIP]: "They don't need us right now.",
};

/**
 * Removed before ranking: an excluded category (not a customer), closed, rating under 4.0, no real local
 * address. Only for cold leads: someone who asked for a check (site form, Meta ad) is never filtered out.
 */
export function skipReason(lead: LeadFacts & { address: string | null }, inbound: boolean, excluded: string | null = null): string | null {
  if (inbound) return null;
  if (excluded) return excluded;
  if (!lead.placeId) return null; // case A is "call last", not skipped
  if (closed(lead.status)) return "Marked closed on Google";
  if (lead.rating != null && lead.rating < 4.0) return `Rating ${fmt(lead.rating)}★ (under 4.0)`;
  if (!lead.address || !/\d/.test(lead.address)) return "No street address (service area only)";
  return null;
}

export type PriorityInput = {
  case: CaseKey;
  rank: number | null;
  flags: SiteFlags;
  locationMismatch?: boolean; // §4.1
  paying?: boolean; // §4.2: an agency built the site, or they pay HomeAdvisor / Angi / Thumbtack / Porch
};

/**
 *   1+  paying an agency or lead service, ranked #4–20
 *   1   #4–20 with a clear, fixable gap: category, rating, a real review gap, location mismatch, weak site
 *   2   top 3 with a weak or no website
 *   3   close, no clear gap
 *   4   not in the top 20, or not on Google
 *   Skip  top 3 with a website that passes (callback in 6 months)
 */
export function callPriority(p: PriorityInput): number {
  if (p.case === "G") return weakSite(p.flags) ? 2 : SKIP;
  if (p.rank == null || p.case === "A" || p.case === "C") return 4;
  if (p.paying) return 0;
  if (p.case === "B" || p.case === "D" || p.case === "E" || p.locationMismatch || weakSite(p.flags)) return 1;
  return 3;
}

// ---------- Results link ----------

export const slugPart = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");

/** bouldhq.com/check/rubio-brothers-concrete-pleasant-grove-k3x9: readable, with a code so links can't be guessed. */
export function makeSlug(name: string, city: string | null, code: string): string {
  return [slugPart(name), city ? slugPart(city) : "", code].filter(Boolean).join("-");
}
