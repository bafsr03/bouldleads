import { body, bad, json } from "@/lib/api";
import { db } from "@/lib/db";
import { intake } from "@/lib/check/intake";
import { parseMetaLeads } from "@/lib/check/meta-csv";

// Meta Instant Form leads from Leads Center → Download, tagged "Meta ad", each checked on the way
// in (spec v2 Part 4). The CSV is decoded in the browser (lib/check/meta-csv.ts decodeCsv).
export const maxDuration = 300;

export type ImportRow = { business: string | null; city: string | null; id?: number; case?: string | null; merged?: boolean; skipped?: string; error?: string };

export async function POST(req: Request) {
  const b = await body<{ csv?: string }>(req);
  if (typeof b.csv !== "string" || !b.csv.trim()) return bad("Choose the CSV you downloaded from Meta Leads Center.");
  const { leads, missing } = parseMetaLeads(b.csv);
  if (missing.length) return bad(`This file has no ${missing.join(", ")} column. Is it the export of the ranking-check Instant Form?`);

  const out: ImportRow[] = [];
  for (const l of leads) {
    const row: ImportRow = { business: l.business, city: l.city };
    if (!l.business || !l.phone) {
      out.push({ ...row, skipped: "No business name or phone" });
      continue;
    }
    if (l.metaId && (await db.get("SELECT id FROM businesses WHERE lead_contact LIKE ?", `%"metaId":${JSON.stringify(l.metaId)}%`))) {
      out.push({ ...row, skipped: "Already imported" });
      continue;
    }
    try {
      const r = await intake({
        kind: "meta",
        business: l.business,
        city: l.city,
        service: l.service,
        name: l.name,
        phone: l.phone,
        email: l.email,
        metaId: l.metaId,
        formSource: "meta-instant-form",
        utm: { utm_source: "facebook", utm_medium: "instant_form", ...(l.campaign ? { utm_campaign: l.campaign } : {}), ...(l.ad ? { utm_content: l.ad } : {}) },
      });
      out.push(r.ok ? { ...row, id: r.id, case: r.case, merged: r.merged } : { ...row, error: r.error });
    } catch (e) {
      out.push({ ...row, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json({ ok: true, rows: out });
}
