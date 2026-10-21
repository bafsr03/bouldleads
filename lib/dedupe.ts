import { db, marks, type Stmt } from "./db";
import { deleteLeads } from "./leads";
import { coreName, similarName } from "./discovery/match";
import { phoneKey } from "./discovery/run-search";

// Duplicate leads: one business that ended up as two or more rows (two Google listings, an OSM and
// a Google copy, an older import). Calling it twice wastes a dial and splits its history.
// Two rows are the same business when they share:
//   a Google place ID                                   always
//   a phone number or a website, and a similar name     "Ross Automotive" / "Ross Automotive Inc"
//   the same name (minus Inc/LLC…) within about 1 km    "Romaine Electric" / "Romaine Electric/Intermountain Electric"
// Different businesses on one phone (an owner with two companies) are kept apart: names must match.

export type DupLead = {
  id: number;
  name: string;
  phone: string | null;
  domain: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  call_attempts: number;
  audit: string | null;
  chain: number;
};


const km = (a: DupLead, b: DupLead) => {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** The same name, or one name containing the other as whole words ("Romaine Electric" in "Romaine Electric/Intermountain Electric"). */
function sameName(a: string, b: string) {
  const x = coreName(a);
  const y = coreName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.split(" ").length >= 2 && ` ${long} `.includes(` ${short} `);
}

/** Why two rows are the same business, or null. */
export function sameBusiness(a: DupLead, b: DupLead): string | null {
  if (a.google_place_id && a.google_place_id === b.google_place_id) return "same Google listing";
  // Chain locations share a website and a brand name: never one business.
  if (a.chain || b.chain) return null;
  const similar = similarName(coreName(a.name), coreName(b.name));
  const pa = phoneKey(a.phone);
  if (pa && pa === phoneKey(b.phone) && similar) return "same phone";
  if (a.domain && a.domain === b.domain && similar) return "same website";
  if (sameName(a.name, b.name) && km(a, b) <= 1) return "same name, same place";
  return null;
}

export type DupGroup = { keep: DupLead; drop: DupLead[]; why: string[] };

/** The lead to keep: the one with call history, then an audit, then the oldest. */
const rank = (l: DupLead) => [l.call_attempts, l.audit ? 1 : 0, -l.id];
const better = (a: DupLead, b: DupLead) => {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b;
  return a;
};

/** Group duplicates (union-find over every matching pair). Pure: no database. */
export function findDuplicates(leads: DupLead[]): DupGroup[] {
  const parent = new Map<number, number>(leads.map((l) => [l.id, l.id]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const why = new Map<string, string>();
  // Only compare rows that could match: same place ID, phone, domain or name root.
  const buckets = new Map<string, DupLead[]>();
  const add = (k: string | null, l: DupLead) => k && buckets.set(k, [...(buckets.get(k) ?? []), l]);
  for (const l of leads) {
    add(l.google_place_id && `p:${l.google_place_id}`, l);
    add(phoneKey(l.phone) && `t:${phoneKey(l.phone)}`, l);
    add(l.domain && `d:${l.domain}`, l);
    add(`n:${coreName(l.name).split(" ").slice(0, 2).join(" ")}`, l);
  }
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 50) continue;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const r = sameBusiness(list[i], list[j]);
        if (!r) continue;
        const [a, b] = [find(list[i].id), find(list[j].id)];
        if (a !== b) parent.set(b, a);
        why.set(`${Math.min(list[i].id, list[j].id)}-${Math.max(list[i].id, list[j].id)}`, r);
      }
  }
  const groups = new Map<number, DupLead[]>();
  for (const l of leads) {
    const r = find(l.id);
    groups.set(r, [...(groups.get(r) ?? []), l]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const keep = g.reduce(better);
      const ids = new Set(g.map((l) => l.id));
      const reasons = [...why].filter(([k]) => k.split("-").every((id) => ids.has(Number(id)))).map(([, r]) => r);
      return { keep, drop: g.filter((l) => l !== keep), why: [...new Set(reasons)] };
    });
}

export async function loadDupCandidates(): Promise<DupLead[]> {
  return db.all<DupLead>("SELECT id, name, phone, domain, google_place_id, lat, lng, call_attempts, audit, chain FROM businesses");
}

// Fields the kept lead takes from a duplicate when it has none of its own.
const FILL = [
  "phone", "website", "domain", "email", "email_source", "email_confidence", "social_url", "ask_for", "address", "city",
  "google_place_id", "google_maps_url", "google_type", "google_types", "rating", "review_count", "business_status",
];

/**
 * Merge each group into its kept lead: fill its gaps, move call history and email sequences over,
 * keep the strongest "do not call" / bad-phone flags, then delete the duplicates. Searches won't
 * re-add them: a new listing with the same place, phone or name merges into the kept lead.
 */
export async function mergeDuplicates(groups: DupGroup[]): Promise<number> {
  let merged = 0;
  for (const g of groups) {
    const keep = g.keep.id;
    const drop = g.drop.map((d) => d.id);
    const m = marks(drop.length);
    const pick = (col: string) => `(SELECT d.${col} FROM businesses d WHERE d.id IN (${m}) AND d.${col} IS NOT NULL ORDER BY d.call_attempts DESC LIMIT 1)`;
    const stmts: Stmt[] = [
      [`UPDATE businesses SET ${FILL.map((c) => `${c} = COALESCE(${c}, ${pick(c)})`).join(", ")} WHERE id = ?`, ...FILL.flatMap(() => drop), keep],
      // Call state: the kept lead's own, unless only a duplicate was ever called.
      [
        `UPDATE businesses SET
           call_outcome = COALESCE(call_outcome, ${pick("call_outcome")}),
           called_at = COALESCE(called_at, ${pick("called_at")}),
           callback_at = COALESCE(callback_at, ${pick("callback_at")}),
           call_attempts = call_attempts + (SELECT COALESCE(SUM(call_attempts), 0) FROM businesses WHERE id IN (${m})),
           dnc = MAX(dnc, (SELECT COALESCE(MAX(dnc), 0) FROM businesses WHERE id IN (${m}))),
           audit_status = 'queued'
         WHERE id = ?`,
        ...drop, ...drop, ...drop, ...drop, ...drop, keep,
      ],
      [`UPDATE calls SET business_id = ? WHERE business_id IN (${m})`, keep, ...drop],
      // An email sequence moves over unless the kept lead already has one in that campaign.
      [`UPDATE OR IGNORE campaign_leads SET business_id = ? WHERE business_id IN (${m})`, keep, ...drop],
    ];
    await db.batch(stmts);
    await deleteLeads(drop, false);
    merged += drop.length;
  }
  return merged;
}
