import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// One SQLite database for the app and the background tasks.
// Hosted: Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN). Local: a file in data/.
// Foreign keys are not enforced (Turso runs each statement on its own connection), so deletes
// clean up child rows explicitly (see lib/leads.ts deleteLeads, campaigns DELETE).

export const DATA_DIR = process.env.BOULDLEADS_DATA_DIR ?? path.join(process.cwd(), "data");
// The Vercel Marketplace integration and the Turso dashboard name these slightly differently; accept both.
export const hostedUrl = () =>
  process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || process.env.LIBSQL_URL || (process.env.DATABASE_URL?.startsWith("libsql://") ? process.env.DATABASE_URL : undefined);
export const hostedToken = () => process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || process.env.LIBSQL_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;
export const isHosted = () => !!hostedUrl();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'osm',          -- osm | google | both
  area TEXT NOT NULL,                          -- JSON: {type:'circle'|'area', ...}
  categories TEXT NOT NULL,                    -- JSON string[]
  country_code TEXT,
  require_website INTEGER NOT NULL DEFAULT 1,    -- 1 = website or email, 2 = any contact incl. phone, 0 = none
  max_results INTEGER NOT NULL DEFAULT 5000,
  status TEXT NOT NULL DEFAULT 'queued',       -- queued | running | done | failed | cancelled
  tiles_total INTEGER NOT NULL DEFAULT 0,
  tiles_done INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id INTEGER REFERENCES searches(id) ON DELETE SET NULL,
  source TEXT NOT NULL,                        -- osm | google
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  address TEXT,
  city TEXT,
  country_code TEXT,
  lat REAL,
  lng REAL,
  phone TEXT,
  website TEXT,
  domain TEXT,
  email TEXT,
  email_source TEXT,                           -- URL or 'osm-tag' where the address was published
  email_confidence INTEGER,                    -- 0-100
  site_summary TEXT,                           -- title/description snippet used for personalization
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | no_website | no_email | verified | invalid | excluded
  enrich_attempts INTEGER NOT NULL DEFAULT 0,
  enriched_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);
CREATE INDEX IF NOT EXISTS idx_businesses_domain ON businesses(domain);
CREATE INDEX IF NOT EXISTS idx_businesses_email ON businesses(email);
CREATE INDEX IF NOT EXISTS idx_businesses_search ON businesses(search_id);

CREATE TABLE IF NOT EXISTS inboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  from_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_secure INTEGER NOT NULL,
  imap_host TEXT,
  imap_port INTEGER,
  imap_secure INTEGER,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  daily_cap INTEGER NOT NULL DEFAULT 40,
  warmup_enabled INTEGER NOT NULL DEFAULT 1,
  warmup_start INTEGER NOT NULL,               -- epoch ms of first warm-up day
  sent_date TEXT,                              -- YYYY-MM-DD for sent_today counter
  sent_today INTEGER NOT NULL DEFAULT 0,
  next_send_at INTEGER NOT NULL DEFAULT 0,
  imap_last_uid INTEGER NOT NULL DEFAULT 0,
  imap_uid_validity TEXT,
  last_error TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,                         -- JSON [{subject, body, delayDays}]
  inbox_ids TEXT NOT NULL,                     -- JSON number[]
  lead_filter TEXT NOT NULL,                   -- JSON filter used to pick leads
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | active | paused | completed
  created_at INTEGER NOT NULL,
  launched_at INTEGER
);

CREATE TABLE IF NOT EXISTS campaign_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  inbox_id INTEGER REFERENCES inboxes(id),
  step INTEGER NOT NULL DEFAULT 0,             -- index of the next step to send
  next_send_at INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued',        -- queued | in_sequence | completed | replied | bounced | unsubscribed | failed | skipped | stopped
  personal_line TEXT,
  thread_message_id TEXT,                      -- Message-ID of step 1, follow-ups reply to it
  thread_subject TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(campaign_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_cl_due ON campaign_leads(campaign_id, state, next_send_at);
CREATE INDEX IF NOT EXISTS idx_cl_email ON campaign_leads(email);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_lead_id INTEGER NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE,
  inbox_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_mid ON messages(message_id);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_lead_id INTEGER REFERENCES campaign_leads(id) ON DELETE CASCADE,
  inbox_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                          -- reply | unsubscribe | bounce
  from_email TEXT,
  subject TEXT,
  snippet TEXT,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  value TEXT PRIMARY KEY,                      -- lowercase email or @domain
  reason TEXT NOT NULL,                        -- unsubscribed | bounced | replied | manual
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',       -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS google_cache (
  key TEXT PRIMARY KEY,                        -- e.g. rank:<query>:<lat>,<lng>
  value TEXT NOT NULL,                         -- JSON
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,                       -- see lib/calls.ts OUTCOMES
  note TEXT,
  user TEXT,                                   -- who logged it (login name)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_business ON calls(business_id);

-- Leads someone deleted: re-running a search won't bring them back.
CREATE TABLE IF NOT EXISTS dismissed (
  key TEXT PRIMARY KEY,                        -- place:<google id> | src:<source>:<id> | domain:<domain>
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

// Columns added after the first release. SQLite can't "ADD COLUMN IF NOT EXISTS", so check first.
const COLUMNS: Record<string, [string, string][]> = {
  businesses: [
    // Google Business Profile data (from Google Places, when a key is set)
    ["google_place_id", "TEXT"],
    ["google_maps_url", "TEXT"],
    ["google_type", "TEXT"],
    ["rating", "REAL"],
    ["review_count", "INTEGER"],
    ["business_status", "TEXT"], // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
    // Audit (Bould Golden Formula: Leads = Visibility × Conversion)
    ["audit_status", "TEXT"], // null | queued | running | done | failed
    ["audit", "TEXT"], // JSON AuditResult
    ["audit_manual", "TEXT"], // JSON { checks: {id: pass|fail}, notes }
    ["audited_at", "INTEGER"],
    ["visibility_score", "INTEGER"], // 0-20, playbook stage 2
    ["conversion_score", "INTEGER"], // 0-100, website check
    ["priority", "INTEGER"], // 0-100, how good a lead this is for Bould
    ["tier", "TEXT"], // A | B | C | not_fit
    // Calling (call-first outreach)
    ["call_outcome", "TEXT"], // latest disposition, see lib/calls.ts
    ["called_at", "INTEGER"],
    ["call_attempts", "INTEGER NOT NULL DEFAULT 0"],
    ["callback_at", "INTEGER"], // when to call back: set = a warm lead (they asked, or bad timing)
    ["dnc", "INTEGER NOT NULL DEFAULT 0"], // do not call (and do not email)
    ["phone_bad", "INTEGER NOT NULL DEFAULT 0"], // wrong number
    ["chain", "INTEGER NOT NULL DEFAULT 0"], // 3+ locations with the same name in one search: not a local-business lead
    ["deep", "TEXT"], // JSON: Google profile details (reviews, photos, hours) from the deep audit
    ["deep_at", "INTEGER"],
    ["google_types", "TEXT"], // JSON string[]: Google's place types, used to confirm the category
    ["category_confirmed", "INTEGER"], // 1 = confirmed by Google/OSM/the name, 2 = set by a person, 0 = only the search term, null = older lead
    ["social_url", "TEXT"], // Facebook / Instagram / Yelp page given as their website: kept, but it isn't a site of their own
    ["warm_tries", "INTEGER NOT NULL DEFAULT 0"], // missed attempts on a warm lead (callback set): after WARM_MAX it goes back to Call again
    ["ask_for", "TEXT"], // who to ask for: "Jamie answers, ask for Kenny"
    ["found_site", "TEXT"], // their website when Google doesn't link one (lib/audit/find-site.ts)
    ["found_site_how", "TEXT"], // phone | name (confirmed on the page) | possible (check it)
    ["site_search_at", "INTEGER"], // when we last looked for an unlinked site
    // Top-3 check (Competitor Check spec v2, lib/check)
    ["google_primary_type", "TEXT"], // Google's primary type id ("concrete_contractor"): compared with the top 3's
    ["check_query", "TEXT"], // the search the check ran, editable on the lead card ("concrete contractor in Pleasant Grove")
    ["top_check", "TEXT"], // JSON TopCheck: rank, top 20, case, website flags
    ["checked_at", "INTEGER"],
    ["check_case", "TEXT"], // A-G (lib/check/diagnose.ts CASES), 'none' = no check (excluded, or no customer search)
    ["check_priority", "INTEGER"], // 0 = 1+ (paying, #4–20), 1 call first … 4 call last, 9 skip
    ["seasonal", "INTEGER NOT NULL DEFAULT 0"], // seasonal trade: called after year-round ones in the same priority
    ["check_slug", "TEXT"], // bouldhq.com/check/<slug>, made by "Copy results link"
    ["check_opened_at", "INTEGER"], // last time the owner opened their results link
    ["check_opens", "INTEGER NOT NULL DEFAULT 0"],
    ["lead_source", "TEXT"], // site | meta | google-ads-mn: they asked for a check or a quote (never filtered out of the call list)
    ["lead_contact", "TEXT"], // JSON: who asked, their email, what they do, UTM (site / Meta leads)
    // Lead Sourcing & Scoring Improvements (Oct 28 2026)
    ["check_query_manual", "INTEGER NOT NULL DEFAULT 0"], // 1 = the check's search was typed by a person: kept, not rebuilt
    ["check_note", "TEXT"], // why there's no check: "Excluded category: Labor union" / no customer search (check_case 'none')
    ["big_ticket", "INTEGER NOT NULL DEFAULT 0"], // roofing, remodeling, waterproofing…: called first within a priority
    ["revisit_at", "INTEGER"], // top 3 with a good site: skipped until this date (6 months)
    ["site_builder", "TEXT"], // who built their website ("Big West Marketing"), from the footer or the call
    ["site_builder_manual", "INTEGER NOT NULL DEFAULT 0"], // 1 = typed on the call: the audit doesn't overwrite it
    ["talked_to", "TEXT"], // who we talked to on the call
    ["marketing_spend", "TEXT"], // what they pay for marketing, if they said
    ["next_step", "TEXT"],
    ["bad_reason", "TEXT"], // Bad lead: not_customer | already_top3 | wrong_trade | out_of_business | wrong_number
  ],
  searches: [
    ["place", "TEXT"], // "Lima, Peru": groups searches on the Places page
    ["cursor", "TEXT"], // JSON {googleDone, nextTile}: lets a search resume across background ticks
  ],
  campaigns: [["kind", "TEXT NOT NULL DEFAULT 'campaign'"]], // campaign | followup (the no-answer sequence)
  calls: [
    ["pitch", "TEXT"], // the lead's pitch type when called (website | visibility | both | corporate | solid): which pitch books
    ["bad_reason", "TEXT"], // for outcome bad_lead: feeds the filters and the bad-lead rate
  ],
};

async function migrate(c: Client) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set((await c.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name as string));
    for (const [name, type] of cols) if (!have.has(name)) await c.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  await c.executeMultiple(`CREATE INDEX IF NOT EXISTS idx_businesses_priority ON businesses(priority);
    CREATE INDEX IF NOT EXISTS idx_businesses_audit ON businesses(audit_status);
    CREATE INDEX IF NOT EXISTS idx_businesses_place ON businesses(google_place_id);
    CREATE INDEX IF NOT EXISTS idx_businesses_geo ON businesses(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_businesses_call ON businesses(call_outcome);
    CREATE INDEX IF NOT EXISTS idx_cl_business ON campaign_leads(business_id);
    CREATE INDEX IF NOT EXISTS idx_businesses_check ON businesses(check_priority);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_slug ON businesses(check_slug);
    CREATE INDEX IF NOT EXISTS idx_businesses_callback ON businesses(callback_at);`);
  // Once: every audited lead is researched again under the Oct 28 2026 rules (service + city + state
  // searches, the state in the city lookup, excluded categories, the website grade and the new call
  // order). Closed leads are left alone; the free-tier guard still caps the Google calls.
  const REAUDIT_KEY = "once:reaudit-2026-10-29"; // not "sys:": copy-to-hosted keeps those out
  if (!(await c.execute({ sql: "SELECT 1 FROM settings WHERE key = ?", args: [REAUDIT_KEY] })).rows.length) {
    await c.execute(`UPDATE businesses SET audit_status = 'queued' WHERE audit_status IN ('done', 'failed') AND dnc = 0
      AND COALESCE(call_outcome, '') NOT IN ('won', 'not_interested', 'do_not_call', 'wrong_number', 'disconnected', 'bad_lead')`);
    await c.execute({ sql: "INSERT INTO settings (key, value) VALUES (?, ?)", args: [REAUDIT_KEY, String(Date.now())] });
  }
  // Once: intake used to store "Ask for Kenny (asked for a check)", shown as "Ask for: Ask for Kenny…".
  const ASKFOR_KEY = "once:askfor-prefix-2026-10-29";
  if (!(await c.execute({ sql: "SELECT 1 FROM settings WHERE key = ?", args: [ASKFOR_KEY] })).rows.length) {
    await c.execute("UPDATE businesses SET ask_for = substr(ask_for, 9) WHERE ask_for LIKE 'Ask for %'");
    await c.execute({ sql: "INSERT INTO settings (key, value) VALUES (?, ?)", args: [ASKFOR_KEY, String(Date.now())] });
  }
  // Places for searches made before the column existed.
  const missing = (await c.execute("SELECT id, label, area FROM searches WHERE place IS NULL")).rows;
  for (const r of missing) {
    const area = JSON.parse(String(r.area)) as { type?: string; label?: string };
    const place = area.type === "place" && area.label ? placeFromLabel(area.label) : String(r.label).split(" · ").slice(1).join(" · ") || null;
    await c.execute({ sql: "UPDATE searches SET place = ? WHERE id = ?", args: [place, r.id] });
  }
}

/** "Lima, Province of Lima, Lima, Peru" → "Lima, Peru": city and country, for grouping searches by place. */
export function placeFromLabel(label: string): string | null {
  const parts = label.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : parts[0];
}

export type Arg = InValue | undefined;
type Args = Arg[] | [Record<string, Arg>];
export type Row = Record<string, unknown>;
export type RunResult = { changes: number; lastId: number };

/** Statement for db.batch: [sql, ...args]. */
export type Stmt = [string, ...Args];

const clean = (v: Arg): InValue => (v === undefined ? null : v);

function toStmt(sql: string, args: Args) {
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !(args[0] instanceof Uint8Array) && !(args[0] instanceof Date) && !(args[0] instanceof ArrayBuffer))
    return { sql, args: Object.fromEntries(Object.entries(args[0] as Record<string, Arg>).map(([k, v]) => [k, clean(v)])) };
  return { sql, args: (args as Arg[]).map(clean) };
}

const plain = <T>(r: unknown) => ({ ...(r as object) }) as T;

type Executor = Pick<Client, "execute"> | Transaction;

function queries(x: Executor) {
  return {
    async get<T = Row>(sql: string, ...args: Args): Promise<T | undefined> {
      const r = (await x.execute(toStmt(sql, args))).rows[0];
      return r ? plain<T>(r) : undefined;
    },
    async all<T = Row>(sql: string, ...args: Args): Promise<T[]> {
      return (await x.execute(toStmt(sql, args))).rows.map((r) => plain<T>(r));
    },
    async run(sql: string, ...args: Args): Promise<RunResult> {
      const r = await x.execute(toStmt(sql, args));
      return { changes: r.rowsAffected, lastId: Number(r.lastInsertRowid ?? 0) };
    },
    /** Single number from a COUNT(*) AS n style query. */
    async count(sql: string, ...args: Args): Promise<number> {
      const r = (await x.execute(toStmt(sql, args))).rows[0];
      return r ? Number(Object.values(r)[0] ?? 0) : 0;
    },
  };
}

export type Queries = ReturnType<typeof queries>;

declare global {
  var __bouldleadsDb: Promise<Client> | undefined;
}

/** Connect to a database URL (libsql:// or file:) and create/upgrade its tables. */
export async function openClient(url: string, authToken?: string): Promise<Client> {
  const c = createClient({ url, authToken });
  if (url.startsWith("file:")) {
    await c.execute("PRAGMA journal_mode = WAL");
    await c.execute("PRAGMA busy_timeout = 10000");
  }
  await c.executeMultiple(SCHEMA);
  await migrate(c);
  return c;
}

export const localDbUrl = () => `file:${path.join(DATA_DIR, "bouldleads.db")}`;

async function open(): Promise<Client> {
  if (isHosted()) return openClient(hostedUrl()!, hostedToken());
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return openClient(localDbUrl());
}

/** The shared client, connected and migrated once per process. */
export function client(): Promise<Client> {
  if (!globalThis.__bouldleadsDb) {
    globalThis.__bouldleadsDb = open();
    globalThis.__bouldleadsDb.catch(() => (globalThis.__bouldleadsDb = undefined));
  }
  return globalThis.__bouldleadsDb;
}

const lazy: Executor = { execute: (async (stmt: Parameters<Client["execute"]>[0]) => (await client()).execute(stmt)) as Client["execute"] };

export const db = {
  ...queries(lazy),
  /** Run several writes atomically. */
  async batch(stmts: Stmt[]): Promise<RunResult[]> {
    const rs = await (await client()).batch(
      stmts.map(([sql, ...args]) => toStmt(sql, args as Args)),
      "write",
    );
    return rs.map((r) => ({ changes: r.rowsAffected, lastId: Number(r.lastInsertRowid ?? 0) }));
  },
  /** Read-then-write in one transaction. Retries briefly if the local file is busy. */
  async tx<T>(fn: (q: Queries) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let t: Transaction | undefined;
      try {
        t = await (await client()).transaction("write");
        const out = await fn(queries(t));
        await t.commit();
        return out;
      } catch (e) {
        t?.close();
        const busy = e instanceof Error && /SQLITE_BUSY|database is locked/i.test(e.message);
        if (!busy || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));
      }
    }
  },
};

export const now = () => Date.now();

export async function logEvent(level: "info" | "warn" | "error", message: string) {
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[${level}] ${message}`);
  try {
    await db.run("INSERT INTO events (level, message, created_at) VALUES (?, ?, ?)", level, message.slice(0, 2000), now());
  } catch {}
}

/** "?,?,?" for an IN (...) list. */
export const marks = (n: number) => Array(n).fill("?").join(",");
