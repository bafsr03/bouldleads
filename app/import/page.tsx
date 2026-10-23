"use client";

import Link from "next/link";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { send } from "@/components/use-api";
import { CASES, type CaseKey } from "@/lib/check/diagnose";
import { decodeCsv } from "@/lib/check/meta-csv";
import type { ImportRow } from "@/app/api/import/meta/route";

export default function ImportPage() {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const csv = decodeCsv(new Uint8Array(await file.arrayBuffer()));
      const r = await send<{ rows: ImportRow[] }>("/api/import/meta", "POST", { csv });
      setRows(r.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const added = rows?.filter((r) => r.id).length ?? 0;
  return (
    <>
      <PageHeader
        title="Import Meta leads"
        description="Ranking-check leads from the Meta Instant Form. Each one is matched to its Google profile, gets the top-3 check, and lands in Callbacks, due now, tagged Meta ad. Call within an hour during business hours."
      />
      <Card className="space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            In Meta Business Suite open <b>All tools → Instant Forms</b> (or Leads Center), pick the ranking-check form and <b>Download → CSV</b>.
          </li>
          <li>Choose that file below. Importing the same file twice is safe: leads already imported are skipped.</li>
        </ol>
        <label className="inline-flex">
          <input type="file" accept=".csv,text/csv,text/tab-separated-values" className="sr-only" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          <span className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            <Upload size={15} /> {busy ? "Importing and checking… (a few seconds a lead)" : "Choose the Meta CSV"}
          </span>
        </label>
        {error && <Notice tone="red">{error}</Notice>}
      </Card>

      {rows && (
        <Card className="mt-4">
          <p className="mb-3 text-sm">
            {added} lead{added === 1 ? "" : "s"} added or updated. <Link className="text-accent hover:underline" href="/callbacks">Open Callbacks →</Link>
          </p>
          <ul className="divide-y divide-border text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                {r.id ? (
                  <Link className="font-medium hover:text-accent hover:underline" href={`/leads/${r.id}`}>
                    {r.business}
                  </Link>
                ) : (
                  <span className="font-medium">{r.business ?? "(no business name)"}</span>
                )}
                {r.city && <span className="text-muted">{r.city}</span>}
                {r.case && <Badge tone="blue">{`${r.case} ${CASES[r.case as CaseKey]}`}</Badge>}
                {r.merged && <Badge>already a lead: updated</Badge>}
                {r.id && !r.case && <Badge tone="amber">check runs with the audit</Badge>}
                {r.skipped && <Badge>{r.skipped}</Badge>}
                {r.error && <Badge tone="red">{r.error}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
