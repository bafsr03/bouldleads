"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, Label, Notice, PageHeader, Select, Stat, StatusBadge, Textarea, ago, fmt } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { confirmDialog, toast } from "@/components/feedback";
import { MERGE_TAGS } from "@/lib/outreach/render";
import { TEMPLATES } from "@/lib/outreach/templates";
import { X } from "lucide-react";
import { ruleFor } from "@/lib/compliance/rules";
import type { LeadFilter, Step } from "@/lib/outreach/campaigns";

type Campaign = {
  id: number;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  kind: "campaign" | "followup";
  steps: Step[];
  inbox_ids: number[];
  lead_filter: LeadFilter;
  states: { state: string; n: number }[];
  recent: { id: number; business_id: number; email: string; state: string; step: number; next_send_at: number; last_error: string | null; name: string; city: string | null }[];
  replies: { id: number; kind: string; from_email: string; subject: string; snippet: string; received_at: number; name: string }[];
  sent: number;
  launched_at: number | null;
};

type Preview = {
  lead: { id: number; name: string; email: string | null; city: string | null };
  rule: { level: string; law: string; summary: string };
  emails: { subject: string; body: string }[];
  aiError: string | null;
};

export default function CampaignPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <CampaignEditor />
    </Suspense>
  );
}

function CampaignEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: c, reload } = useApi<Campaign>(`/api/campaigns/${id}`, 8000);
  const { data: inboxes } = useApi<{ id: number; email: string; from_name: string; active: number; daily_cap: number }[]>("/api/inboxes");
  const { data: searches } = useApi<{ id: number; label: string; verified: number }[]>("/api/searches");
  const { data: leadTypes } = useApi<{ type: string; total: number; verified: number }[]>("/api/leads/types");
  const { data: settings } = useApi<{ settings: { aiProvider: string; companyName: string; postalAddress: string } }>("/api/settings");

  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [inboxIds, setInboxIds] = useState<number[]>([]);
  const [filter, setFilter] = useState<LeadFilter>({});
  const [count, setCount] = useState<{ count: number; countries: { cc: string; n: number }[] } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offset, setOffset] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [focusStep, setFocusStep] = useState(0);
  const loaded = useRef(false);

  // Load server state once into the editor.
  useEffect(() => {
    if (c && !loaded.current) {
      loaded.current = true;
      setName(c.name);
      setSteps(c.steps);
      setInboxIds(c.inbox_ids);
      setFilter(c.lead_filter);
    }
  }, [c]);

  const draft = c?.status === "draft";

  useEffect(() => {
    if (!loaded.current || !draft) return;
    const t = setTimeout(() => send<typeof count>("/api/campaigns/count", "POST", filter).then(setCount).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [filter, draft]);

  useEffect(() => {
    if (!loaded.current || steps.length === 0) return;
    const t = setTimeout(
      () =>
        send<Preview>("/api/campaigns/preview", "POST", {
          steps,
          filter,
          offset,
          followup: c?.kind === "followup",
          senderName: inboxes?.find((i) => inboxIds.includes(i.id))?.from_name,
        })
          .then(setPreview)
          .catch(() => {}),
      400,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, filter, offset, inboxIds, inboxes]);

  if (!c) return <p className="text-sm text-muted">Loading…</p>;

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };
  const setStep = (i: number, patch: Partial<Step>) => edit(setSteps)(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setF = (patch: Partial<LeadFilter>) => edit(setFilter)({ ...filter, ...patch });

  async function save() {
    try {
      await send(`/api/campaigns/${id}`, "PATCH", { name, steps, inboxIds, ...(draft ? { filter } : {}) });
      setDirty(false);
      toast("Campaign saved.");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function action(a: "launch" | "pause" | "resume") {
    if (
      a === "launch" &&
      !(await confirmDialog({
        title: `Launch to ${fmt(count?.count)} leads?`,
        body: "The lead list is frozen at launch. Emails go out gradually during your send window, within each inbox's daily limit.",
        confirmLabel: "Launch campaign",
      }))
    )
      return;
    try {
      if (dirty) await send(`/api/campaigns/${id}`, "PATCH", { name, steps, inboxIds, ...(draft ? { filter } : {}) });
      const r = await send<{ enrolled?: number }>(`/api/campaigns/${id}`, "PATCH", { action: a });
      setDirty(false);
      toast(a === "launch" ? `Launched with ${fmt(r.enrolled)} leads. Sending starts in the next send window.` : a === "pause" ? "Campaign paused." : "Campaign resumed.");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  function insertTag(tag: string) {
    const st = steps[focusStep];
    if (st) setStep(focusStep, { body: `${st.body}{{${tag}}}` });
  }

  const stateCount = (s: string) => c.states.find((x) => x.state === s)?.n ?? 0;
  const totalLeads = c.states.reduce((a, b) => a + b.n, 0);
  const isFollowup = c.kind === "followup";
  const missingSetup = settings && (!settings.settings.companyName || !settings.settings.postalAddress);

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={c.status} />
            {isFollowup ? (
              <span>Sent automatically to leads who don&apos;t pick up (Call list → No answer / Voicemail).</span>
            ) : (
              c.launched_at && <span>launched {ago(c.launched_at)}</span>
            )}
          </span>
        }
        actions={
          <>
            <Button onClick={save} disabled={!dirty}>
              Save
            </Button>
            {draft && (
              <Button variant="primary" onClick={() => action("launch")} disabled={!count?.count || inboxIds.length === 0}>
                Launch
              </Button>
            )}
            {c.status === "active" && <Button onClick={() => action("pause")}>Pause</Button>}
            {c.status === "paused" && (
              <Button variant="primary" onClick={() => action("resume")}>
                Resume
              </Button>
            )}
            {draft && (
              <Button
                variant="danger"
                onClick={async () => {
                  if (!(await confirmDialog({ title: "Delete this draft?", confirmLabel: "Delete", danger: true }))) return;
                  await send(`/api/campaigns/${id}`, "DELETE");
                  toast("Draft deleted.");
                  router.push("/campaigns");
                }}
              >
                Delete
              </Button>
            )}
          </>
        }
      />

      {missingSetup && (
        <div className="mb-4">
          <Notice tone="red">Add your company name and postal address in Settings before launching. They&apos;re legally required in every email footer.</Notice>
        </div>
      )}

      {isFollowup && inboxIds.length === 0 && (
        <div className="mb-4">
          <Notice tone="amber">
            Pick at least one sending inbox below (and Save), or no-answer emails will wait in the queue. <Link href="/inboxes" className="underline">Add an inbox</Link>.
          </Notice>
        </div>
      )}

      {!draft && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Leads" value={fmt(totalLeads)} sub={`${fmt(stateCount("queued"))} not yet contacted`} />
          <Stat label="Sent" value={fmt(c.sent)} sub={`${fmt(stateCount("in_sequence"))} awaiting follow-up`} />
          <Stat label="Replied" value={fmt(stateCount("replied"))} sub={c.sent ? `${((stateCount("replied") / c.sent) * 100).toFixed(1)}%` : ""} />
          <Stat label="Bounced" value={fmt(stateCount("bounced"))} sub={c.sent ? `${((stateCount("bounced") / c.sent) * 100).toFixed(1)}%` : ""} />
          <Stat label="Opted out" value={fmt(stateCount("unsubscribed"))} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="space-y-4">
            <div>
              <Label>Campaign name</Label>
              <Input value={name} onChange={(e) => edit(setName)(e.target.value)} />
            </div>

            {isFollowup ? (
              <div className="rounded-lg bg-background p-3 text-sm text-muted">
                <b className="text-foreground">Who receives it:</b> leads you called that didn&apos;t pick up, as soon as you log No answer or Voicemail. A reply,
                callback, booking, &quot;not interested&quot; or &quot;do not call&quot; stops it for that lead. Delays count from the previous email (default: day 1, 3, 5
                and 12).
              </div>
            ) : (
            <div>
              <Label hint={draft ? "" : "(frozen after launch)"}>Who receives it</Label>
              <div className="grid grid-cols-2 gap-3">
                <Select disabled={!draft} value={filter.searchId ?? ""} onChange={(e) => setF({ searchId: e.target.value ? +e.target.value : null })}>
                  <option value="">All searches</option>
                  {searches?.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} {s.label} ({s.verified})
                    </option>
                  ))}
                </Select>
                <Select
                  disabled={!draft}
                  value=""
                  onChange={(e) => e.target.value && setF({ types: [...(filter.types ?? []), e.target.value], category: null })}
                >
                  <option value="">{filter.types?.length ? "Add another business type…" : "All business types"}</option>
                  {leadTypes
                    ?.filter((t) => t.verified > 0 && !filter.types?.includes(t.type))
                    .map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.type} ({fmt(t.verified)} verified)
                      </option>
                    ))}
                </Select>
                <Input disabled={!draft} placeholder="City contains…" value={filter.city ?? ""} onChange={(e) => setF({ city: e.target.value })} />
                <Input disabled={!draft} placeholder="Country code, e.g. US" maxLength={2} value={filter.country ?? ""} onChange={(e) => setF({ country: e.target.value })} />
                <label className="text-xs text-muted">
                  Lead quality (audit tier)
                  <Select
                    disabled={!draft}
                    value={(filter.tiers ?? []).join(",")}
                    onChange={(e) => setF({ tiers: e.target.value ? e.target.value.split(",") : null })}
                  >
                    <option value="">Any, including not audited</option>
                    <option value="A">Tier A only</option>
                    <option value="A,B">Tier A + B</option>
                    <option value="A,B,C">Any audited lead (except not a fit)</option>
                  </Select>
                </label>
                <label className="text-xs text-muted">
                  Min. email confidence
                  <Input disabled={!draft} type="number" min={0} max={100} value={filter.minConfidence ?? 0} onChange={(e) => setF({ minConfidence: +e.target.value })} />
                </label>
                <label className="text-xs text-muted">
                  Max leads
                  <Input disabled={!draft} type="number" min={1} max={10000} value={filter.limit ?? 1000} onChange={(e) => setF({ limit: +e.target.value })} />
                </label>
              </div>
              {(filter.types?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {filter.types!.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent">
                      {t}
                      {draft && (
                        <button aria-label={`Remove ${t}`} onClick={() => setF({ types: filter.types!.filter((x) => x !== t) })}>
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {draft && count && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm">
                    <b>{fmt(count.count)}</b> verified leads that have never been contacted match.
                  </p>
                  {count.countries
                    .filter((x) => x.cc !== "?")
                    .map((x) => {
                      const r = ruleFor(x.cc);
                      return (
                        <Notice key={x.cc} tone={r.level === "consent" ? "red" : r.level === "ok" ? "green" : "amber"}>
                          <b>
                            {x.cc} ({fmt(x.n)}) · {r.law}:
                          </b>{" "}
                          {r.summary}
                        </Notice>
                      );
                    })}
                </div>
              )}
            </div>
            )}

            <div>
              <Label>Send from</Label>
              {inboxes?.length === 0 && <p className="text-sm text-muted">No inboxes yet. Add one on the Inboxes page.</p>}
              <div className="space-y-1">
                {inboxes?.map((i) => (
                  <label key={i.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={inboxIds.includes(i.id)}
                      onChange={(e) => edit(setInboxIds)(e.target.checked ? [...inboxIds, i.id] : inboxIds.filter((x) => x !== i.id))}
                    />
                    {i.email} <span className="text-xs text-muted">· up to {i.daily_cap}/day</span>
                    {!i.active && <Badge>paused</Badge>}
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Card className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Start from a template</span>
            <Select
              className="flex-1"
              value=""
              onChange={async (e) => {
                const tpl = TEMPLATES.find((x) => x.id === e.target.value);
                if (!tpl) return;
                const ok = await confirmDialog({
                  title: `Use “${tpl.name}”?`,
                  body: "This replaces the emails below. You can edit everything afterwards.",
                  confirmLabel: "Use template",
                });
                if (ok) edit(setSteps)(tpl.steps.map((s) => ({ ...s })));
              }}
            >
              <option value="">Choose a template…</option>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}: {t.description}
                </option>
              ))}
            </Select>
          </Card>

          {steps.map((st, i) => (
            <Card key={i} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{i === 0 ? "First email" : `Follow-up ${i}`}</h3>
                {i > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    send after
                    <Input type="number" min={1} max={30} className="h-8 w-16" value={st.delayDays} onChange={(e) => setStep(i, { delayDays: +e.target.value })} />
                    days if no reply
                    <Button size="sm" variant="ghost" onClick={() => edit(setSteps)(steps.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  </div>
                )}
              </div>
              <div>
                <Label hint={i > 0 ? "(leave empty to reply in the same thread)" : ""}>Subject</Label>
                <Input value={st.subject} onFocus={() => setFocusStep(i)} onChange={(e) => setStep(i, { subject: e.target.value })} />
              </div>
              <div>
                <Label>Body</Label>
                <Textarea rows={i === 0 ? 10 : 5} value={st.body} onFocus={() => setFocusStep(i)} onChange={(e) => setStep(i, { body: e.target.value })} />
              </div>
            </Card>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {steps.length < 4 && (
              <Button size="sm" onClick={() => edit(setSteps)([...steps, { subject: "", body: "", delayDays: 4 }])}>
                + Add follow-up
              </Button>
            )}
            <span className="text-xs text-muted">Insert:</span>
            {MERGE_TAGS.map((t) => (
              <button key={t} onClick={() => insertTag(t)} className="rounded-md border border-border px-2 py-0.5 font-mono text-xs hover:border-accent">
                {`{{${t}}}`}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Use <code className="font-mono">{"{Hi|Hello|Hey}"}</code> to vary wording between emails, and <code className="font-mono">{"{{city|your area}}"}</code> for a
            fallback when a value is missing. <code className="font-mono">{"{{personal_line}}"}</code> is an AI-written opener (turn it on in Settings) and is left
            blank when AI is off. <code className="font-mono">{"{{audit_issue}}"}</code> is the #1 issue the lead audit found (e.g. &quot;your phone number
            isn&apos;t tappable on mobile…&quot;); <code className="font-mono">{"{{search_term}}"}</code>, <code className="font-mono">{"{{map_rank}}"}</code>,{" "}
            <code className="font-mono">{"{{rating}}"}</code> and <code className="font-mono">{"{{review_count}}"}</code> come from Google. Always give audit tags a
            fallback, and pick audited tiers above. Your footer with company address and opt-out line is added automatically.
          </p>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Preview</h3>
              <div className="flex items-center gap-2 text-xs text-muted">
                {preview?.lead && (
                  <span>
                    {preview.lead.name} · {preview.lead.email}
                  </span>
                )}
                <Button size="sm" onClick={() => setOffset(offset + 1)}>
                  Next lead
                </Button>
              </div>
            </div>
            {settings?.settings.aiProvider !== "none" && (
              <Button
                size="sm"
                className="mb-3"
                onClick={() =>
                  send<Preview>("/api/campaigns/preview", "POST", { steps, filter, offset, ai: true }).then(setPreview).catch(() => {})
                }
              >
                Preview with AI opener
              </Button>
            )}
            {preview?.aiError && <Notice tone="red">AI: {preview.aiError}</Notice>}
            <div className="space-y-4">
              {preview?.emails.map((e, i) => (
                <div key={i} className="rounded-lg border border-border">
                  <div className="border-b border-border px-3 py-2 text-sm">
                    <span className="text-muted">{i === 0 ? "Subject:" : `Follow-up ${i}:`}</span> <b>{e.subject}</b>
                  </div>
                  <pre className="whitespace-pre-wrap px-3 py-3 font-sans text-sm leading-relaxed">{e.body}</pre>
                </div>
              ))}
            </div>
          </Card>

          {!draft && c.replies.length > 0 && (
            <Card>
              <h3 className="mb-2 font-semibold">Replies</h3>
              <ul className="space-y-3 text-sm">
                {c.replies.map((r) => (
                  <li key={r.id} className="border-b border-border pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <b>{r.name}</b> <StatusBadge status={r.kind === "reply" ? "replied" : r.kind === "bounce" ? "bounced" : "unsubscribed"} />
                      <span className="ml-auto text-xs text-muted">{ago(r.received_at)}</span>
                    </div>
                    <div className="mt-1 line-clamp-3 text-muted">{r.snippet}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!draft && (
            <Card className="overflow-x-auto p-0">
              <h3 className="px-4 pt-4 font-semibold">Recent activity</h3>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {c.recent.map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="px-4 py-2">
                        <div>{r.name}</div>
                        <div className="font-mono text-xs text-muted">{r.email}</div>
                        {r.last_error && <div className="text-xs text-red-600">{r.last_error}</div>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">step {r.step}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
