import { db, marks, now, type Stmt } from "./db";
import { STAGE_SQL } from "./calls";
import { dismissKeys } from "./discovery/run-search";

// Shared lead-table filtering for the list endpoint, the call list, bulk actions and CSV export.

export type LeadListFilter = {
  status?: string | null;
  q?: string | null;
  searchId?: string | null;
  place?: string | null; // all searches in a place, e.g. "Lima, Peru"
  stage?: string | null; // call-first stage, see STAGE_SQL (comma-separated for several)
  country?: string | null;
  type?: string | null;
  tier?: string | null; // A | B | C | not_fit | unscored
  phone?: string | null; // "1" = has a phone number
  calls?: string | null; // "open" = not yet won / not interested
  sort?: string | null; // newest | priority | callback | called
};

export function leadListWhere(f: LeadListFilter) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status && f.status !== "all") {
    where.push("status = ?");
    params.push(f.status);
  }
  if (f.searchId) {
    where.push("search_id = ?");
    params.push(Number(f.searchId));
  }
  if (f.place) {
    where.push("search_id IN (SELECT id FROM searches WHERE place = ?)");
    params.push(f.place);
  }
  if (f.stage) {
    const stages = f.stage.split(",").filter(Boolean);
    where.push(`(${STAGE_SQL}) IN (${marks(stages.length)})`);
    params.push(...stages);
  }
  if (f.country) {
    where.push("country_code = ?");
    params.push(f.country.toUpperCase());
  }
  if (f.type) {
    where.push("category = ?");
    params.push(f.type);
  }
  if (f.tier) {
    // One tier, "AB", or a comma list; "unscored" = not audited yet.
    const tiers = f.tier === "AB" ? ["A", "B"] : f.tier.split(",").filter(Boolean);
    const named = tiers.filter((t) => t !== "unscored");
    const parts = [...(named.length ? [`tier IN (${marks(named.length)})`] : []), ...(tiers.includes("unscored") ? ["tier IS NULL"] : [])];
    where.push(`(${parts.join(" OR ")})`);
    params.push(...named);
  }
  if (f.phone === "1") where.push("phone IS NOT NULL AND phone != ''");
  if (f.phone === "1") where.push("phone_bad = 0");
  if (f.calls === "open") where.push("COALESCE(call_outcome, '') NOT IN ('not_interested', 'won', 'do_not_call') AND dnc = 0 AND status != 'excluded'");
  if (f.q) {
    where.push("(name LIKE ? OR email LIKE ? OR city LIKE ? OR category LIKE ? OR domain LIKE ? OR address LIKE ? OR phone LIKE ?)");
    params.push(...Array(7).fill(`%${f.q}%`));
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export const leadOrder = (f: LeadListFilter) =>
  ({
    // Competitor Check spec v2 §3.4: call order from the top-3 check first (1 one clear gap … 4 most
    // work, unchecked next, skip last), year-round trades before seasonal ones, then the audit priority.
    priority: "ORDER BY COALESCE(check_priority, 5), seasonal, priority IS NULL, priority DESC, id DESC",
    callback: "ORDER BY callback_at IS NULL, callback_at, priority DESC",
    called: "ORDER BY called_at DESC, id DESC",
  })[f.sort ?? ""] ?? "ORDER BY id DESC";

export const FILTER_KEYS = ["status", "q", "searchId", "place", "stage", "country", "type", "tier", "phone", "calls", "sort"] as const;

export const filterFromUrl = (url: string): LeadListFilter => filterFromParams(new URL(url).searchParams);

export const filterFromParams = (p: URLSearchParams | Record<string, string | null | undefined>): LeadListFilter => {
  const get = (k: string) => (p instanceof URLSearchParams ? p.get(k) : (p[k] ?? null));
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k) || null])) as LeadListFilter;
};

/** ids from an explicit list, or every lead matching a filter ("select all N"). */
export async function resolveIds(sel: { ids?: unknown; filter?: Record<string, string | null> }): Promise<number[]> {
  if (Array.isArray(sel.ids)) return sel.ids.map(Number).filter(Number.isInteger);
  if (sel.filter) {
    const { where, params } = leadListWhere(filterFromParams(sel.filter));
    return (await db.all<{ id: number }>(`SELECT id FROM businesses ${where}`, ...params)).map((r) => r.id);
  }
  return [];
}

const chunk = <T>(a: T[], n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Permanently delete leads and everything hanging off them (calls, outreach, replies).
 * With `remember`, re-running a search won't add them back.
 */
export async function deleteLeads(ids: number[], remember = true): Promise<number> {
  let deleted = 0;
  for (const part of chunk(ids)) {
    const m = marks(part.length);
    const stmts: Stmt[] = [];
    if (remember) {
      const rows = await db.all<{ source: string; source_id: string; google_place_id: string | null }>(
        `SELECT source, source_id, google_place_id FROM businesses WHERE id IN (${m})`,
        ...part,
      );
      // Not the domain: other locations of a chain would disappear too.
      for (const r of rows)
        for (const key of dismissKeys({ source: r.source, sourceId: r.source_id, placeId: r.google_place_id }))
          stmts.push(["INSERT OR IGNORE INTO dismissed (key, created_at) VALUES (?, ?)", key, now()]);
    }
    const cl = `SELECT id FROM campaign_leads WHERE business_id IN (${m})`;
    stmts.push(
      [`DELETE FROM replies WHERE campaign_lead_id IN (${cl})`, ...part],
      [`DELETE FROM messages WHERE campaign_lead_id IN (${cl})`, ...part],
      [`DELETE FROM campaign_leads WHERE business_id IN (${m})`, ...part],
      [`DELETE FROM calls WHERE business_id IN (${m})`, ...part],
      [`DELETE FROM businesses WHERE id IN (${m})`, ...part],
    );
    const rs = await db.batch(stmts);
    deleted += rs[rs.length - 1].changes;
  }
  return deleted;
}

type StoredAudit = {
  findings?: { say: string }[];
  verdict?: { label: string };
  pattern?: { label: string };
  pitch?: { key: string; label: string };
  site?: { key: string; label: string };
};

export type AuditSummary = {
  top_issue: string | null;
  verdict: string | null;
  pattern: string | null;
  pitch: string | null; // website | visibility | both | corporate | solid
  site_state: string | null; // none | social | directory | down | parked | blocked | unchecked | ok
  site_label: string | null; // "Facebook only", "Couldn't check"…
};

/** Short summary of a stored audit for list views and CSV. */
export function auditSummary(audit: string | null): AuditSummary {
  try {
    const a = audit ? (JSON.parse(audit) as StoredAudit) : null;
    return {
      top_issue: a?.findings?.[0]?.say ?? null,
      verdict: a?.verdict?.label ?? null,
      pattern: a?.pattern?.label ?? null,
      pitch: a?.pitch?.key ?? null,
      site_state: a?.site?.key ?? null,
      site_label: a?.site?.label ?? null,
    };
  } catch {
    return { top_issue: null, verdict: null, pattern: null, pitch: null, site_state: null, site_label: null };
  }
}

export const topIssue = (audit: string | null) => auditSummary(audit).top_issue;
