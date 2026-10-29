"use client";

import { ArrowLeft, Check as CheckIcon, Copy, ExternalLink, Globe, Mail, MapPin, Minus, Phone, PhoneCall, RefreshCw, Reply, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, Notice, PageHeader, StatusBadge, Textarea, ago, cx } from "@/components/ui";
import { PitchBadge, Rating, ScoreMeter, SiteChip, StageBadge, TierBadge, followupText, outcomeLabel } from "@/components/score";
import { AskFor } from "@/components/ask-for";
import { WARM_MAX, badReasonLabel } from "@/lib/call-outcomes";
import { CallActions, LocalTime } from "@/components/call-actions";
import { CallFacts } from "@/components/call-facts";
import { CategoryLabel } from "@/components/category-label";
import { send, useApi } from "@/components/use-api";
import { useEmailOn } from "@/components/use-flags";
import { confirmWithOption, toast } from "@/components/feedback";
import type { AuditResult, Check } from "@/lib/audit/score";
import { callBrief } from "@/lib/audit/brief";
import { TopCheckPanel, type CheckLead } from "@/components/top-check";


/** Research older than 90 days (the background job re-audits these a few a day). */
const stale = (at: number | null) => !!at && Date.now() - at > 90 * 86_400_000;

type Lead = {
  id: number;
  name: string;
  category: string | null;
  category_confirmed: number | null;
  address: string | null;
  city: string | null;
  country_code: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  status: string;
  source: string;
  google_maps_url: string | null;
  rating: number | null;
  review_count: number | null;
  audit_status: string | null;
  audited_at: number | null;
  audit: AuditResult | null;
  audit_manual: { checks?: Record<string, "pass" | "fail">; notes?: string; lastMonthLeads?: string };
  top_check: CheckLead["top_check"];
  check_query: string | null;
  check_slug: string | null;
  check_opened_at: number | null;
  check_opens: number;
  lead_source: string | null;
  lead_contact: CheckLead["lead_contact"];
  call_outcome: string | null;
  called_at: number | null;
  call_attempts: number;
  callback_at: number | null;
  dnc: number;
  phone_bad: number;
  ask_for: string | null;
  talked_to: string | null;
  site_builder: string | null;
  marketing_spend: string | null;
  next_step: string | null;
  bad_reason: string | null;
  social_url: string | null;
  found_site: string | null;
  found_site_how: string | null;
  warm_tries: number;
  lat: number | null;
  lng: number | null;
  stage: string;
  tz: string | null;
  site_summary: string | null;
  search: { id: number; label: string; place: string | null } | null;
  outreach: { state: string; step: number; updated_at: number; campaign_id: number; campaign: string; kind: string }[];
  replies: { kind: string; subject: string | null; snippet: string | null; received_at: number }[];
  calls: { id: number; outcome: string; note: string | null; user: string | null; created_at: number; bad_reason: string | null }[];
  emails: { step: number; subject: string; sent_at: number; campaign: string }[];
  followup: { state: string; step: number; steps: number; nextSendAt: number | null } | null;
  followupBlocked: string | null;
};

type Event = { at: number; kind: "call" | "email" | "reply"; title: string; detail?: string | null; by?: string | null };

function timeline(l: Lead): Event[] {
  return [
    ...l.calls.map((c) => ({
      at: c.created_at,
      kind: "call" as const,
      title: c.bad_reason ? `${outcomeLabel(c.outcome)}: ${badReasonLabel(c.bad_reason).toLowerCase()}` : outcomeLabel(c.outcome),
      detail: c.note,
      by: c.user,
    })),
    ...l.emails.map((e) => ({ at: e.sent_at, kind: "email" as const, title: `Email ${e.step + 1} sent: ${e.subject}`, detail: e.campaign })),
    ...l.replies.map((r) => ({
      at: r.received_at,
      kind: "reply" as const,
      title: r.kind === "reply" ? "Replied" : r.kind === "unsubscribe" ? "Asked to be removed" : "Email bounced",
      detail: r.snippet,
    })),
  ].sort((a, b) => b.at - a.at);
}

const EVENT_ICON = { call: PhoneCall, email: Send, reply: Reply };

// The playbook's stage-1 call script, in order.
const SCRIPT = [
  "Ask about their situation: “Where do your customers come from today? Has your website ever brought you a job you can point to?”",
  "Run the visibility audit live, with their Google profile open. They see their own business, not a pitch.",
  "Explain Leads = Visibility × Conversion and which side is holding them back.",
  "Show Rubio's case study: old site, 12 months, 0 leads → first lead in 2 weeks, 6 leads and $20,000 in 3 months.",
  "Recommend the package the score points to and quote from the pricing page.",
  "Book the onboarding call before hanging up.",
];

function StateIcon({ state }: { state: Check["state"] }) {
  if (state === "pass")
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-label="Pass">
        <CheckIcon size={12} strokeWidth={3} />
      </span>
    );
  if (state === "fail")
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" aria-label="Fail">
        <X size={12} strokeWidth={3} />
      </span>
    );
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted" aria-label="Not checked yet">
      <Minus size={12} />
    </span>
  );
}

const METHOD_LABEL = { auto: "auto", estimated: "estimate", manual: "on the call" } as const;

function CheckRow({ c, onSet }: { c: Check; onSet?: (state: "pass" | "fail" | null) => void }) {
  return (
    <li className="flex gap-3 border-b border-border/60 py-2.5 last:border-0">
      <StateIcon state={c.state} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span>{c.label}</span>
          <span className="text-xs text-muted">
            {c.points} pt{c.points === 1 ? "" : "s"} · {c.overridden ? "answered" : METHOD_LABEL[c.method]}
          </span>
        </div>
        {c.evidence && <div className="mt-0.5 text-xs text-muted">{c.evidence}</div>}
      </div>
      {onSet && (
        <div className="flex shrink-0 items-start gap-1">
          <button
            onClick={() => onSet(c.overridden && c.state === "pass" ? null : "pass")}
            className={cx("rounded-md border px-2 py-0.5 text-xs", c.overridden && c.state === "pass" ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-border text-muted hover:text-foreground")}
            title="Mark as true"
          >
            Yes
          </button>
          <button
            onClick={() => onSet(c.overridden && c.state === "fail" ? null : "fail")}
            className={cx("rounded-md border px-2 py-0.5 text-xs", c.overridden && c.state === "fail" ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300" : "border-border text-muted hover:text-foreground")}
            title="Mark as false"
          >
            No
          </button>
        </div>
      )}
    </li>
  );
}

function LeadInner() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const emailOn = useEmailOn();
  const [notes, setNotes] = useState<string | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const { data: l, reload, error } = useApi<Lead>(`/api/leads/${id}`, 8000);
  if (error === "Not found") return <Notice tone="red">This lead was deleted.</Notice>;
  if (!l) return <p className="text-sm text-muted">Loading…</p>;
  const a = l.audit;
  const busy = l.audit_status === "queued" || l.audit_status === "running";

  async function setCheck(checkId: string, state: "pass" | "fail" | null) {
    await send(`/api/leads/${id}`, "PATCH", { check: { id: checkId, state } });
    reload();
  }
  async function runAudit() {
    // Deep audit: website + contact page, Google profile (reviews, photos, hours), map rank and PageSpeed.
    setDeepBusy(true);
    toast("Running a deep audit: website, Google profile and mobile speed. This takes up to a minute.", "info");
    try {
      await send(`/api/leads/${id}`, "POST", { action: "deep" });
      toast("Deep audit done.");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setDeepBusy(false);
      reload();
    }
  }
  async function remove() {
    const r = await confirmWithOption({
      title: `Delete ${l!.name}?`,
      body: "Removes the lead, its call history and any scheduled emails. This can't be undone.",
      confirmLabel: "Delete lead",
      danger: true,
      checkbox: { label: "Don't add it back when we search this area again", checked: true },
    });
    if (!r.ok) return;
    await send(`/api/leads/${id}?remember=${r.checked ? 1 : 0}`, "DELETE");
    toast(`${l!.name} deleted.`);
    router.push("/leads");
  }
  async function followup(action: "followup" | "stop_followup") {
    try {
      await send(`/api/leads/${id}`, "POST", { action });
      toast(action === "followup" ? "Follow-up emails started." : "Follow-up emails stopped.", "info");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }
  async function saveNotes() {
    if (notes == null || notes === (l!.audit_manual.notes ?? "")) return;
    await send(`/api/leads/${id}`, "PATCH", { notes });
    toast("Notes saved.", "info");
    reload();
  }


  const fu = followupText(l.followup);
  const fuActive = l.followup && (l.followup.state === "queued" || l.followup.state === "in_sequence");
  const events = timeline(l);
  const callPanel = (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Call</h2>
        <span className="text-xs text-muted">
          {l.call_attempts ? `${l.call_attempts} call${l.call_attempts === 1 ? "" : "s"} · last ${ago(l.called_at)}` : "Not called yet"}
        </span>
      </div>
      {l.dnc ? (
        <Notice tone="red">Do not call or email this business.</Notice>
      ) : (
        <CallActions lead={l} onDone={reload} />
      )}
      <CallFacts lead={l} onSaved={reload} />
      {l.callback_at && (
        <p className="text-sm">
          <span className="text-muted">Call back:</span>{" "}
          {new Date(l.callback_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {l.warm_tries > 0 && <span className="text-muted"> · try {l.warm_tries + 1} of {WARM_MAX}</span>}
        </p>
      )}
      {emailOn && (
      <div className="rounded-lg bg-background p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">No-answer email follow-up</span>
          {fuActive ? (
            <Button size="sm" onClick={() => followup("stop_followup")}>Stop emails</Button>
          ) : (
            !l.followupBlocked &&
            (!l.followup || l.followup.state === "stopped") && (
              <Button size="sm" onClick={() => followup("followup")}>
                <Mail size={13} /> {l.followup?.state === "stopped" ? "Resume" : "Start"}
              </Button>
            )
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          {fu ?? (l.followupBlocked ? `Not possible: ${l.followupBlocked}` : "Starts automatically when you log No answer or Voicemail.")}
        </p>
      </div>
      )}
      <Textarea
        rows={4}
        placeholder="Notes: leads per month, busy season, who answers the phone…"
        value={notes ?? l.audit_manual.notes ?? ""}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
      />
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Call script</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
          {SCRIPT.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      </details>
    </Card>
  );
  const activity = (
    <Card>
      <h2 className="mb-2 font-semibold">Activity</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No calls or emails yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((e, i) => {
            const Icon = EVENT_ICON[e.kind];
            return (
              <li key={i} className="flex gap-2.5 text-sm">
                <span
                  className={cx(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    e.kind === "reply" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-accent-soft text-accent",
                  )}
                >
                  <Icon size={12} />
                </span>
                <div className="min-w-0">
                  <div>
                    {e.title}
                    <span className="text-xs text-muted">
                      {" "}
                      · {ago(e.at)}
                      {e.by && ` · ${e.by}`}
                    </span>
                  </div>
                  {e.detail && <p className="mt-0.5 line-clamp-3 text-xs text-muted">{e.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {l.outreach.filter((o) => o.kind !== "followup").length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Campaigns</div>
          <ul className="space-y-1.5 text-sm">
            {l.outreach
              .filter((o) => o.kind !== "followup")
              .map((o) => (
                <li key={o.campaign_id} className="flex items-center justify-between gap-2">
                  <Link href={`/campaigns/${o.campaign_id}`} className="truncate hover:text-accent">
                    {o.campaign}
                  </Link>
                  <StatusBadge status={o.state} />
                </li>
              ))}
          </ul>
        </div>
      )}
    </Card>
  );
  const visGroups = a ? [...new Set(a.visibility.checks.map((c) => c.group))] : [];
  const site = a?.inputs.site;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft size={14} /> Back
        </button>
        {l.search && (
          <Link href={`/leads?searchId=${l.search.id}`} className="hover:text-foreground">
            {l.search.place ?? "Search"} · search #{l.search.id}
          </Link>
        )}
      </div>
      <PageHeader
        title={l.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CategoryLabel id={l.id} category={l.category} confirmed={l.category_confirmed} onSaved={reload} />
            {l.review_count != null && <Rating rating={l.rating} count={l.review_count} />}
            <StatusBadge status={l.status} />
            {a && <TierBadge tier={a.tier} />}
            <PitchBadge pitch={a?.pitch?.key} />
            <SiteChip state={a?.site?.key} label={a?.site?.label} website={l.website} socialUrl={l.social_url} />
            <StageBadge stage={l.stage} />
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={remove} className="text-red-700 dark:text-red-400" title="Delete this lead">
              <Trash2 size={14} />
            </Button>
            <Button onClick={runAudit} disabled={busy || deepBusy} title="Website, contact page, Google profile (reviews, photos, hours), map rank and mobile speed">
              <RefreshCw size={14} className={cx((busy || deepBusy) && "animate-spin")} />
              {busy || deepBusy ? "Auditing…" : "Deep audit"}
            </Button>
            <Button variant="primary" onClick={() => navigator.clipboard.writeText(callBrief(l)).then(() => toast("Call brief copied. Paste it anywhere.", "info"))}>
              <Copy size={14} /> Copy call brief
            </Button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {l.phone && (
          <a
            href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}
            className={cx("inline-flex items-center gap-1.5 font-medium text-accent hover:underline", !!l.phone_bad && "text-muted line-through")}
            title={l.phone_bad ? (l.call_outcome === "disconnected" ? "Number disconnected" : "Marked as a wrong number") : undefined}
          >
            <Phone size={14} /> {l.phone}
          </a>
        )}
        <AskFor id={l.id} value={l.ask_for} onSaved={reload} className="text-sm" />
        <LocalTime tz={l.tz} />
        {l.email && (
          <button className="inline-flex items-center gap-1.5 hover:text-accent" onClick={() => navigator.clipboard.writeText(l.email!).then(() => toast("Email copied.", "info"))}>
            <Mail size={14} /> {l.email}
          </button>
        )}
        {l.website && (
          <a href={l.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-accent">
            <Globe size={14} /> {new URL(l.website).hostname.replace(/^www\./, "")}
          </a>
        )}
        {!l.website && l.found_site && (
          <a
            href={l.found_site}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-amber-700 hover:text-accent dark:text-amber-400"
            title={l.found_site_how === "possible" ? "A site with their name: we couldn't confirm it's theirs" : "Their website, found by us: their Google profile doesn't link it"}
          >
            <Globe size={14} /> {new URL(l.found_site).hostname.replace(/^www\./, "")}
            {l.found_site_how === "possible" ? " (maybe theirs)" : " (not on Google)"}
          </a>
        )}
        {l.google_maps_url && (
          <a href={l.google_maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-accent">
            <ExternalLink size={14} /> Google profile
          </a>
        )}
        {l.address && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <MapPin size={14} /> {l.address}
          </span>
        )}
      </div>

      <TopCheckPanel lead={l} onChange={reload} />

      {!a && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Notice tone={l.audit_status === "failed" ? "red" : "blue"}>
              {busy
                ? "Researching this business: checking its Google profile, map ranking and website…"
                : l.audit_status === "failed"
                  ? "The last audit failed (see Overview → Activity). Press Run audit to try again."
                  : "Not audited yet. Press Run audit to research this business."}
            </Notice>
          </div>
          <div className="order-first space-y-4 lg:order-none lg:col-span-2">
            {callPanel}
            {activity}
          </div>
        </div>
      )}

      {a && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <ScoreMeter
                label="Visibility"
                value={a.visibility.score}
                max={20}
                tone="accent"
                sub={
                  a.visibility.open
                    ? `${20 - a.visibility.open} of 20 pts checked · ${a.visibility.open} to check on the call (not counted against them)`
                    : "All checks answered"
                }
              />
            </Card>
            <Card>
              {a.conversion.hasWebsite && !a.conversion.measured ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">Conversion</div>
                  <div className="mt-1 text-3xl font-semibold text-muted">–</div>
                  <div className="mt-1.5 text-xs text-muted">{a.conversion.note}</div>
                </div>
              ) : (
                <ScoreMeter
                  label="Conversion"
                  value={a.conversion.score}
                  max={100}
                  tone="muted"
                  sub={a.conversion.note ?? "Homepage checked against the build standard"}
                />
              )}
            </Card>
            <Card>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Verdict{a.verdict.provisional && " (provisional)"}</div>
              <div className="mt-1 text-xl font-semibold">{a.verdict.label}</div>
              <p className="mt-1 text-xs text-muted">{a.verdict.offer}.</p>
              <p className="mt-1 text-xs">
                <span className="text-muted">Set expectations:</span> {a.verdict.expectation}.
              </p>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{a.pattern.label}</h2>
                  <span className="text-xs text-muted">
                    {a.tierReason}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{a.pattern.explain}</p>
                <h3 className="mb-2 mt-4 text-sm font-semibold">Talking points</h3>
                {a.findings.length === 0 ? (
                  <p className="text-sm text-muted">No obvious issues found automatically. Use the call to confirm the open checks.</p>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {a.findings.map((f, i) => (
                      <li key={f.id} className="flex gap-2.5">
                        <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", f.severity === 3 ? "bg-accent text-white" : "bg-accent-soft text-accent")}>
                          {i + 1}
                        </span>
                        <span>{f.say}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              <Card>
                <h2 className="font-semibold">Visibility audit</h2>
                <p className="mb-2 text-xs text-muted">
                  The visibility checks (spec v2: measured against the top 3). Answer the open ones on the call with Yes / No: the score, verdict and tier update instantly.
                </p>
                {visGroups.map((g) => (
                  <div key={g} className="mt-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted">{g}</div>
                    <ul>
                      {a.visibility.checks
                        .filter((c) => c.group === g)
                        .map((c) => (
                          <CheckRow key={c.id} c={c} onSet={(s) => setCheck(c.id, s)} />
                        ))}
                    </ul>
                  </div>
                ))}
              </Card>

              <Card>
                <h2 className="font-semibold">Conversion check</h2>
                <p className="mb-2 text-xs text-muted">Their homepage against the Golden Formula build standard.</p>
                {a.conversion.hasWebsite && a.conversion.measured ? (
                  <ul>
                    {a.conversion.checks.map((c) => (
                      <CheckRow key={c.id} c={c} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{a.conversion.note ?? "No website to check."}.</p>
                )}
              </Card>
            </div>

            <div className="order-first space-y-4 lg:order-none lg:col-span-2">
              {callPanel}
              {activity}

              {site && site.reachable && !site.socialOnly && (
                <Card>
                  <h2 className="mb-2 font-semibold">Website facts</h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-muted">Built with</dt>
                    <dd>{site.platform ?? "Custom / unknown"}</dd>
                    <dt className="text-muted">Sells online</dt>
                    <dd>{site.ecommerce ? "Yes" : "No"}</dd>
                    {site.booking && (
                      <>
                        <dt className="text-muted">Booking</dt>
                        <dd>{site.booking}</dd>
                      </>
                    )}
                    <dt className="text-muted">Profiles linked</dt>
                    <dd>{site.profiles.length ? site.profiles.join(", ") : "None"}</dd>
                    <dt className="text-muted">Images</dt>
                    <dd>
                      {site.images}
                      {site.imagesNoAlt > 0 && <span className="text-muted"> ({site.imagesNoAlt} without alt text)</span>}
                    </dd>
                  </dl>
                  <p className="mt-3 text-xs text-muted">
                    Build path hint: {site.ecommerce || site.platform === "Shopify" ? "Shopify (they sell online)" : "custom lead-gen site"}.
                  </p>
                </Card>
              )}

              {l.site_summary && (
                <Card>
                  <h2 className="mb-1 font-semibold">What their site says</h2>
                  <p className="text-sm text-muted">{l.site_summary}</p>
                </Card>
              )}

              <p className="text-xs text-muted">
                Audited {ago(l.audited_at)}. {a.inputs.google.note ?? (a.inputs.google.checked ? "Google data included." : "")}
                {stale(l.audited_at) && (
                  <span className="text-amber-700 dark:text-amber-400"> This research is over 3 months old: it refreshes on its own, or press Deep audit now.</span>
                )}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function LeadPage() {
  return (
    <Suspense>
      <LeadInner />
    </Suspense>
  );
}
