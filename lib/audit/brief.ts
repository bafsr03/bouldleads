import type { AuditResult } from "./score";

// Plain-text brief a partner can paste into notes, a CRM or a chat before calling.

export type BriefLead = {
  name: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  google_maps_url: string | null;
  rating: number | null;
  review_count: number | null;
  audit: AuditResult | null;
  audit_manual?: { notes?: string };
};

export function callBrief(l: BriefLead): string {
  const a = l.audit;
  const lines = [
    `${l.name}${l.category ? ` (${l.category})` : ""}`,
    [l.phone && `Phone: ${l.phone}`, l.email && `Email: ${l.email}`, l.website && `Web: ${l.website}`].filter(Boolean).join(" · "),
    [l.address, l.google_maps_url].filter(Boolean).join(" · "),
    l.review_count != null ? `Google: ${l.rating?.toFixed(1) ?? "–"}★ from ${l.review_count} reviews` : "",
  ];
  if (a) {
    lines.push(
      "",
      `Visibility ${a.visibility.score}/20${a.visibility.open ? ` (${a.visibility.open} pts to confirm on the call)` : ""} · Conversion ${a.conversion.score}/100 · Tier ${a.tier === "not_fit" ? "not a fit" : a.tier}`,
      `${a.pattern.label}: ${a.pattern.explain}`,
      `Pitch: ${a.verdict.label}: ${a.verdict.offer}. Expectation: ${a.verdict.expectation}.`,
      "",
      "Talking points:",
      ...a.findings.slice(0, 5).map((f, i) => `${i + 1}. ${f.say}`),
    );
    const open = a.visibility.checks.filter((c) => c.state === "unknown");
    if (open.length) lines.push("", "Confirm on the call:", ...open.map((c) => `- ${c.label}`));
  }
  if (l.audit_manual?.notes) lines.push("", `Notes: ${l.audit_manual.notes}`);
  return lines.filter((x, i, arr) => x !== "" || arr[i - 1] !== "").join("\n").trim();
}

