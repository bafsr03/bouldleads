import type { Client, InValue } from "@libsql/client";

// Copies the local database into the hosted one (Turso) so the team starts with every lead, call
// and email history. Ids are kept, so links and relations stay intact. Not copied:
//   - inboxes and encrypted keys: they're encrypted with this computer's key; re-enter them online
//   - system values (locks, counters) and the activity log
// Campaigns lose their inbox list (local inbox ids); hosted inboxes join the follow-up when added.

const TABLES: { name: string; where?: string; patch?: (row: Record<string, InValue>) => void }[] = [
  { name: "searches" },
  { name: "businesses" },
  { name: "calls" },
  { name: "dismissed" },
  { name: "suppressions" },
  { name: "google_cache" },
  { name: "settings", where: "key NOT LIKE 'secret:%' AND key NOT LIKE 'sys:%'" },
  { name: "campaigns", patch: (r) => void (r.inbox_ids = "[]") },
  { name: "campaign_leads", patch: (r) => void (r.inbox_id = null) },
  { name: "messages" },
  { name: "replies" },
  { name: "jobs", where: "status IN ('queued', 'running')", patch: (r) => void (r.status = "queued") },
];

async function columns(c: Client, table: string): Promise<string[]> {
  return (await c.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
}

export type CopyReport = { table: string; rows: number }[];

export async function copyDatabase(src: Client, dst: Client, opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<CopyReport> {
  const existing = Number((await dst.execute("SELECT COUNT(*) AS n FROM businesses")).rows[0].n);
  if (existing > 0 && !opts.force)
    throw new Error(`The hosted database already has ${existing} leads. Run again with --force to merge (rows with the same id are overwritten).`);

  const report: CopyReport = [];
  for (const t of TABLES) {
    const dstCols = new Set(await columns(dst, t.name));
    const cols = (await columns(src, t.name)).filter((c) => dstCols.has(c));
    const rows = (await src.execute(`SELECT ${cols.join(", ")} FROM ${t.name}${t.where ? ` WHERE ${t.where}` : ""}`)).rows;
    const sql = `INSERT OR REPLACE INTO ${t.name} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    for (let i = 0; i < rows.length; i += 200) {
      await dst.batch(
        rows.slice(i, i + 200).map((row) => {
          const r: Record<string, InValue> = Object.fromEntries(cols.map((c) => [c, row[c] as InValue]));
          t.patch?.(r);
          return { sql, args: cols.map((c) => r[c]) };
        }),
        "write",
      );
    }
    report.push({ table: t.name, rows: rows.length });
    opts.log?.(`${t.name}: ${rows.length} rows`);
  }
  return report;
}
