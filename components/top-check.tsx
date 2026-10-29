"use client";

import { Check as CheckIcon, Copy, Eye, RefreshCw, Star } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Input, Notice, ago, cx } from "./ui";
import { CheckBadge, SourceBadge } from "./score";
import { send } from "./use-api";
import { toast } from "./feedback";
import { PITCH, PRIORITY_LABEL, SKIP } from "@/lib/check/diagnose";
import type { TopCheck } from "@/lib/check/run-check";

export type CheckLead = {
  id: number;
  name: string;
  city: string | null;
  top_check: TopCheck | null;
  check_query: string | null;
  check_slug: string | null;
  check_opened_at: number | null;
  check_opens: number;
  lead_source: string | null;
  check_case?: string | null;
  check_note?: string | null; // why there's no check: excluded category, or no customer search
  lead_contact: { name?: string | null; email?: string | null; service?: string | null; message?: string | null; utm?: Record<string, string> | null } | null;
  audit_manual: { checks?: Record<string, "pass" | "fail">; lastMonthLeads?: string };
};

const stars = (r: number | null) => (r == null ? "–" : r.toFixed(1));

/**
 * What Jake sees before dialing (Competitor Check spec v2 §3.5): rank and search (editable, Re-run),
 * the top 3 with this lead's row, the case and one-line fix, website flags, the three things to
 * ask on the call, and the results link to text the owner.
 */
export function TopCheckPanel({ lead: l, onChange }: { lead: CheckLead; onChange: () => void }) {
  const c = l.top_check;
  const [query, setQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leads, setLeads] = useState<string | null>(null);
  const manual = l.audit_manual.checks ?? {};

  async function rerun() {
    setBusy(true);
    try {
      await send(`/api/leads/${l.id}/check`, "POST", { query: query ?? c?.query ?? l.check_query ?? undefined });
      setQuery(null);
      toast("Top-3 check updated from Google.", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
      onChange();
    }
  }
  async function copyLink() {
    try {
      const r = await send<{ url: string }>(`/api/leads/${l.id}/check/link`, "POST");
      await navigator.clipboard.writeText(r.url);
      toast(`Results link copied: ${r.url}`, "info");
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }
  async function setCheck(id: string, state: "pass" | "fail" | null) {
    await send(`/api/leads/${l.id}`, "PATCH", { check: { id, state } });
    onChange();
  }
  async function saveLeads() {
    if (leads == null || leads === (l.audit_manual.lastMonthLeads ?? "")) return;
    await send(`/api/leads/${l.id}`, "PATCH", { lastMonthLeads: leads });
    toast("Saved: their starting numbers.", "info");
    onChange();
  }

  const rows = c ? c.top.slice(0, 3).map((t, i) => ({ ...t, rank: i + 1, you: !!c.lead.placeId && t.id === c.lead.placeId })) : [];
  const youInTop3 = rows.some((r) => r.you);
  const flags = c?.flags;
  const contact = l.lead_contact;

  return (
    <Card className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Top-3 check</h2>
        <SourceBadge source={l.lead_source} />
        {c && <CheckBadge priority={c.priority} kase={c.diagnosis.case} rank={c.rank} />}
        {l.check_opened_at && (
          <Badge tone="green">
            <Eye size={12} className="mr-1" /> Opened {ago(l.check_opened_at)}
            {l.check_opens > 1 ? ` · ${l.check_opens}×` : ""}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted">{c ? `Checked ${ago(c.at)}` : "Not checked yet"}</span>
      </div>

      {contact && (
        <p className="rounded-lg bg-background p-3 text-sm">
          <span className="text-muted">{l.lead_source === "meta" ? "Meta ad lead" : l.lead_source === "google-ads-mn" ? "Google ads MN quote" : "Asked on bouldhq.com"}:</span> {contact.name ?? "(no name)"}
          {contact.service && <> · does “{contact.service}”</>}
          {contact.email && <> · {contact.email}</>}
          {contact.utm?.utm_source && <span className="text-muted"> · from {[contact.utm.utm_source, contact.utm.utm_campaign].filter(Boolean).join(" / ")}</span>}
          {contact.message && <span className="mt-1 block text-muted">“{contact.message}”</span>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{c ? (c.rank ? `Around #${c.rank}` : c.diagnosis.case === "A" ? "Not on Google" : "Not in the top 20") : "Search"}</span>
        <span className="text-muted">for</span>
        <Input
          className="h-8 w-72 max-w-full"
          value={query ?? c?.query ?? l.check_query ?? ""}
          placeholder="service + city, e.g. concrete contractor pleasant grove"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && rerun()}
        />
        <span className="text-muted">near you</span>
        <Button size="sm" onClick={rerun} disabled={busy} title="Search Google again (uses one lead search from the monthly allowance)">
          <RefreshCw size={13} className={cx(busy && "animate-spin")} /> {busy ? "Checking…" : "Re-run"}
        </Button>
      </div>

      {!c && l.check_case === "none" && l.check_note && <Notice tone="amber">{l.check_note}</Notice>}

      {c && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">#</th>
                  <th className="py-1 pr-3 font-medium">Business</th>
                  <th className="py-1 pr-3 font-medium">Rating</th>
                  <th className="py-1 pr-3 font-medium">Reviews</th>
                  <th className="py-1 font-medium">Category</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...rows,
                  ...(youInTop3 ? [] : [{ id: "you", name: c.lead.name, rating: c.lead.rating, reviews: c.lead.reviews, category: c.lead.category, primaryType: c.lead.primaryType, rank: c.rank, you: true }]),
                ].map((r) => (
                  <tr key={r.id} className={cx("border-t border-border", r.you && "bg-accent/10 font-medium")}>
                    <td className="py-1.5 pr-3 tabular-nums">{r.rank ? `#${r.rank}` : "–"}</td>
                    <td className="py-1.5 pr-3">
                      {r.name}
                      {r.you && <span className="ml-1.5 text-xs text-accent">this lead</span>}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      <Star size={11} className="mr-0.5 inline fill-amber-400 text-amber-400" aria-hidden />
                      {stars(r.rating)}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{r.reviews ?? "–"}</td>
                    <td className="py-1.5 text-muted">{r.category ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">
              Case {c.diagnosis.case}: {c.diagnosis.title}
              {c.diagnosis.gap && <> · gap: {c.diagnosis.gap}</>}
            </div>
            <p className="mt-1 text-base">“{c.diagnosis.say}”</p>
            <p className="mt-1 text-xs text-muted">
              {PRIORITY_LABEL[c.priority]}. Pitch: {PITCH[c.priority]} {c.seasonal && "Seasonal trade: if they're heading into the slow season, plan for spring."}
            </p>
          </div>

          {c.skip && c.priority === SKIP && <Notice tone="amber">Filtered out of the call list: {c.skip}.</Notice>}

          {!!c.findings?.length && (
            <ul className="space-y-1 text-sm">
              {c.findings.map((f) => (
                <li key={f} className="rounded-md bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  “{f}”
                </li>
              ))}
            </ul>
          )}

          {flags && (
            <div className="flex flex-wrap gap-2 text-xs">
              {flags.noSite ? (
                <Flag bad ok="" no="No website: Website Build pitch" />
              ) : c.grade ? (
                <Badge tone={c.grade.grade === "Weak" ? "red" : c.grade.grade === "OK" ? "amber" : "green"}>
                  Site: {c.grade.grade}
                  {c.grade.weakest.length > 0 && ` · ${c.grade.weakest.join(" · ")}`}
                </Badge>
              ) : (
                <Flag bad={false} ok="Has a website (not graded yet)" no="" unknown />
              )}
              {!flags.noSite && (
                <>
                  <Flag
                    bad={flags.slowMobile}
                    ok={flags.mobileScore != null ? `Phone speed ${flags.mobileScore}/100` : "Phone speed not measured"}
                    no={`Slow on a phone: ${flags.mobileScore}/100`}
                    unknown={flags.mobileScore == null}
                  />
                  <Flag bad={flags.noCall} ok="Click-to-call" no="No click-to-call" />
                  <Flag bad={flags.noForm} ok="Has a form" no="No form" />
                </>
              )}
              {c.marketKm != null && c.marketKm > 15 && <Badge tone="amber">{c.marketKm} km from {c.city}: one clear market?</Badge>}
            </div>
          )}
        </>
      )}

      <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-3">
        <CallCheck label="Google profile claimed (owner has access)" state={manual.gbp_verified} onSet={(s) => setCheck("gbp_verified", s)} />
        <CallCheck label="Branded search clean (Google their name before the call)" state={manual.branded} onSet={(s) => setCheck("branded", s)} />
        <label className="text-sm">
          <span className="text-muted">Last month&apos;s leads (their starting numbers)</span>
          <Input
            className="mt-1 h-8"
            placeholder="e.g. ~15 calls, mostly Google"
            value={leads ?? l.audit_manual.lastMonthLeads ?? ""}
            onChange={(e) => setLeads(e.target.value)}
            onBlur={saveLeads}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={copyLink} disabled={!c}>
          <Copy size={13} /> Copy results link
        </Button>
        {l.check_slug && <span className="text-xs text-muted">bouldhq.com/check/{l.check_slug}</span>}
        <span className="text-xs text-muted">Say “around #N” and “near you”. No ranking or lead guarantees.</span>
      </div>
    </Card>
  );
}

function Flag({ bad, ok, no, unknown }: { bad: boolean; ok: string; no: string; unknown?: boolean }) {
  return <Badge tone={bad ? "red" : unknown ? "gray" : "green"}>{bad ? no : ok}</Badge>;
}

function CallCheck({ label, state, onSet }: { label: string; state: "pass" | "fail" | undefined; onSet: (s: "pass" | "fail" | null) => void }) {
  return (
    <div className="text-sm">
      <div className="text-muted">{label}</div>
      <div className="mt-1 flex gap-1">
        <button
          onClick={() => onSet(state === "pass" ? null : "pass")}
          className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs", state === "pass" ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-border text-muted hover:text-foreground")}
        >
          <CheckIcon size={12} /> Yes
        </button>
        <button
          onClick={() => onSet(state === "fail" ? null : "fail")}
          className={cx("rounded-md border px-2 py-0.5 text-xs", state === "fail" ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300" : "border-border text-muted hover:text-foreground")}
        >
          No
        </button>
      </div>
    </div>
  );
}
