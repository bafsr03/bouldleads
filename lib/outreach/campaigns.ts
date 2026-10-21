import { db, now } from "../db";
import { getSettings } from "../settings";
import { CONSENT_COUNTRIES } from "../compliance/rules";
import { footer, render, type MergeVars } from "./render";
import type { AuditResult } from "../audit/score";

export type Step = { subject: string; body: string; delayDays: number };

export type LeadFilter = {
  searchId?: number | null;
  category?: string | null; // legacy "contains" filter
  types?: string[] | null; // exact business types
  city?: string | null;
  country?: string | null;
  minConfidence?: number | null;
  tiers?: string[] | null; // audit tiers, e.g. ["A","B"]
  minPriority?: number | null;
  limit?: number | null;
};

export type CampaignRow = {
  id: number;
  name: string;
  steps: string;
  inbox_ids: string;
  lead_filter: string;
  status: "draft" | "active" | "paused" | "completed";
  kind: "campaign" | "followup";
  created_at: number;
  launched_at: number | null;
};

export type BusinessRow = {
  id: number;
  name: string;
  category: string | null;
  city: string | null;
  country_code: string | null;
  website: string | null;
  domain: string | null;
  email: string | null;
  site_summary: string | null;
  rating?: number | null;
  review_count?: number | null;
  visibility_score?: number | null;
  audit?: string | null;
};

/** WHERE clause for verified leads matching a filter that were never contacted before. */
export async function leadQuery(f: LeadFilter) {
  const where = ["b.status = 'verified'", "b.email IS NOT NULL"];
  const params: (string | number)[] = [];
  if (f.searchId) {
    where.push("b.search_id = ?");
    params.push(f.searchId);
  }
  if (f.types?.length) {
    where.push(`b.category IN (${f.types.map(() => "?").join(",")})`);
    params.push(...f.types);
  } else if (f.category) {
    where.push("b.category LIKE ?");
    params.push(`%${f.category}%`);
  }
  if (f.city) {
    where.push("(b.city LIKE ? OR b.address LIKE ?)");
    params.push(`%${f.city}%`, `%${f.city}%`);
  }
  if (f.country) {
    where.push("b.country_code = ?");
    params.push(f.country.toUpperCase());
  }
  if (f.minConfidence) {
    where.push("COALESCE(b.email_confidence, 0) >= ?");
    params.push(f.minConfidence);
  }
  if (f.tiers?.length) {
    where.push(`b.tier IN (${f.tiers.map(() => "?").join(",")})`);
    params.push(...f.tiers);
  }
  if (f.minPriority) {
    where.push("COALESCE(b.priority, 0) >= ?");
    params.push(f.minPriority);
  }
  // Called leads are worked by phone first; the no-answer follow-up emails them.
  where.push("b.call_outcome IS NULL AND b.dnc = 0");
  if (!(await getSettings()).allowConsentCountries) {
    where.push(`COALESCE(b.country_code, '') NOT IN (${[...CONSENT_COUNTRIES].map(() => "?").join(",")})`);
    params.push(...CONSENT_COUNTRIES);
  }
  // Never email the same address twice across campaigns, and respect suppressions.
  where.push("NOT EXISTS (SELECT 1 FROM campaign_leads x WHERE x.email = b.email)");
  // Chains can share one address: only the first business per email counts.
  where.push("b.id = (SELECT MIN(b2.id) FROM businesses b2 WHERE b2.email = b.email AND b2.status = 'verified')");
  where.push(
    "NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.value = b.email OR s.value = '@' || substr(b.email, instr(b.email, '@') + 1))",
  );
  return { where: where.join(" AND "), params };
}

export async function countMatchingLeads(f: LeadFilter): Promise<number> {
  const { where, params } = await leadQuery(f);
  const n = await db.count(`SELECT COUNT(*) FROM businesses b WHERE ${where}`, ...params);
  return Math.min(n, f.limit ?? Infinity);
}

/** Facts from the lead's audit, for {{audit_issue}}, {{map_rank}} etc. */
function auditVars(b: BusinessRow): Partial<MergeVars> {
  if (!b.audit) return { rating: b.rating ? b.rating.toFixed(1) : null, review_count: b.review_count != null ? String(b.review_count) : null };
  try {
    const a = JSON.parse(b.audit) as AuditResult;
    const g = a.inputs.google;
    return {
      audit_issue: a.findings[0]?.email.replace(/\{\{\s*business_name\s*\}\}/g, b.name) ?? null,
      rating: g.rating ? g.rating.toFixed(1) : null,
      review_count: g.found ? String(g.reviewCount ?? 0) : null,
      map_rank: g.rank ? `#${g.rank}` : null,
      search_term: g.rankQuery,
      visibility_score: `${a.visibility.score}/20`,
    };
  } catch {
    return {};
  }
}

export async function varsFor(b: BusinessRow, senderName: string, personalLine: string | null): Promise<MergeVars> {
  const s = await getSettings();
  return {
    ...auditVars(b),
    business_name: b.name,
    city: b.city,
    category: b.category,
    website: b.website,
    domain: b.domain,
    sender_name: senderName,
    company: s.companyName,
    personal_line: personalLine,
  };
}

export async function renderStep(
  step: Step,
  stepIndex: number,
  b: BusinessRow,
  senderName: string,
  personalLine: string | null,
  threadSubject: string | null,
) {
  const s = await getSettings();
  const vars = await varsFor(b, senderName, personalLine);
  const seed = `${b.id}:${stepIndex}`;
  const subject =
    stepIndex > 0 && !step.subject.trim() && threadSubject ? `Re: ${threadSubject}` : render(step.subject, vars, seed + ":s");
  const body =
    render(step.body, vars, seed) +
    footer({ senderName, companyName: s.companyName, postalAddress: s.postalAddress, optOutLine: s.optOutLine });
  return { subject, body };
}

export async function validateCampaign(steps: Step[], inboxIds: number[]): Promise<string | null> {
  const s = await getSettings();
  if (!s.companyName.trim() || !s.postalAddress.trim())
    return "Set your company name and postal address in Settings first (required by anti-spam laws).";
  if (steps.length === 0 || steps.length > 5) return "Add between 1 and 5 steps.";
  if (!steps[0].subject.trim()) return "The first step needs a subject.";
  if (steps.some((st) => !st.body.trim())) return "Every step needs a body.";
  if (inboxIds.length === 0) return "Pick at least one sending inbox.";
  return null;
}

/** Freeze the lead list for a campaign. Returns the number of leads added. */
export async function enrollLeads(campaignId: number, f: LeadFilter): Promise<number> {
  const { where, params } = await leadQuery(f);
  const limit = f.limit && f.limit > 0 ? f.limit : 10000;
  const r = await db.run(
    `INSERT OR IGNORE INTO campaign_leads (campaign_id, business_id, email, next_send_at, state, updated_at)
     SELECT ?, b.id, b.email, 0, 'queued', ? FROM businesses b WHERE ${where}
     ORDER BY COALESCE(b.priority, -1) DESC, COALESCE(b.email_confidence, 0) DESC, b.id LIMIT ?`,
    campaignId,
    now(),
    ...params,
    limit,
  );
  return r.changes;
}
