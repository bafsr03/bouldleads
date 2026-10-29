"use client";

import { useState } from "react";
import { Input } from "./ui";
import { send } from "./use-api";
import { toast } from "./feedback";

// What we learned on the call (Oct 28 2026 brief §7): who we talked to, who built their site, what
// they pay for marketing, the next step. Each field saves when you leave it.

export type CallFactsLead = {
  id: number;
  talked_to: string | null;
  site_builder: string | null;
  marketing_spend: string | null;
  next_step: string | null;
};

const FIELDS = [
  { key: "talkedTo", col: "talked_to", label: "Who we talked to", placeholder: "e.g. Dave, the owner" },
  { key: "siteBuilder", col: "site_builder", label: "Who built their site", placeholder: "e.g. Big West Marketing" },
  { key: "marketingSpend", col: "marketing_spend", label: "What they pay for marketing", placeholder: "e.g. HomeAdvisor ~$600/mo" },
  { key: "nextStep", col: "next_step", label: "Next step", placeholder: "e.g. screen share Tue 2 pm" },
] as const;

export function CallFacts({ lead, onSaved }: { lead: CallFactsLead; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function save(key: (typeof FIELDS)[number]["key"], col: (typeof FIELDS)[number]["col"]) {
    const v = draft[key];
    if (v === undefined || v.trim() === (lead[col] ?? "")) return;
    try {
      await send(`/api/leads/${lead.id}`, "PATCH", { [key]: v.trim() || null });
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)));
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <label key={f.key} className="text-xs">
          <span className="text-muted">{f.label}</span>
          <Input
            className="mt-0.5 h-8 text-sm"
            value={draft[f.key] ?? lead[f.col] ?? ""}
            placeholder={f.placeholder}
            maxLength={f.key === "siteBuilder" ? 80 : 300}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            onBlur={() => save(f.key, f.col)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </label>
      ))}
    </div>
  );
}
