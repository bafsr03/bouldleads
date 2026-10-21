"use client";

import { useState } from "react";
import { Button, Card, Input, Label, PageHeader, Progress, Select, Textarea, ago, fmt } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { confirmDialog, toast } from "@/components/feedback";
import { refreshFlags } from "@/components/use-flags";
import type { Settings } from "@/lib/settings";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Toronto",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Santiago",
  "Europe/London",
  "Europe/Madrid",
  "Australia/Sydney",
  "UTC",
];

export default function SettingsPage() {
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const { data, reload } = useApi<{
    settings: Settings;
    secrets: { anthropicApiKey: boolean; googlePlacesApiKey: boolean };
    secretsFromEnv: { anthropicApiKey: boolean; googlePlacesApiKey: boolean };
    googleUsage: { sku: string; label: string; used: number; free: number | null }[];
  }>("/api/settings");
  const { data: dismissed, reload: reloadDismissed } = useApi<{ count: number }>("/api/dismissed");
  const { data: supp, reload: reloadSupp } = useApi<{ value: string; reason: string; created_at: number }[]>("/api/suppressions");
  // Local edits; falls back to the saved settings until the user changes something.
  const [draft, setS] = useState<Settings | null>(null);
  const s = draft ?? data?.settings ?? null;
  const [keys, setKeys] = useState({ anthropicApiKey: "", googlePlacesApiKey: "" });
  const [block, setBlock] = useState("");

  if (!s || !data) return <p className="text-sm text-muted">Loading…</p>;
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  async function save() {
    try {
      const secrets: Record<string, string> = {};
      if (keys.anthropicApiKey) secrets.anthropicApiKey = keys.anthropicApiKey;
      if (keys.googlePlacesApiKey) secrets.googlePlacesApiKey = keys.googlePlacesApiKey;
      await send("/api/settings", "PUT", { settings: s, secrets });
      setKeys({ anthropicApiKey: "", googlePlacesApiKey: "" });
      toast("Settings saved.");
      refreshFlags();
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <Button variant="primary" onClick={save}>
            Save settings
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-semibold">Sender identity (required)</h2>
          <p className="text-sm text-muted">
            CAN-SPAM, CASL and GDPR require every commercial email to identify the sender and include a physical postal address and a way to opt out. This is
            added as a footer to every email.
          </p>
          <div>
            <Label>Company name</Label>
            <Input value={s.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="BouldHQ" />
          </div>
          <div>
            <Label>Postal address</Label>
            <Input value={s.postalAddress} onChange={(e) => set({ postalAddress: e.target.value })} placeholder="123 Main St, Austin, TX 78701, USA" />
          </div>
          <div>
            <Label>Opt-out line</Label>
            <Textarea rows={2} value={s.optOutLine} onChange={(e) => set({ optOutLine: e.target.value })} />
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">Sending schedule</h2>
          <div>
            <Label hint="(send hours and daily limits follow this zone)">Time zone</Label>
            <Select value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {[...new Set([s.timezone, browserTz, ...ZONES])].filter(Boolean).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                  {z === browserTz ? " (this computer)" : ""}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start hour</Label>
              <Input type="number" min={0} max={23} value={s.sendWindowStart} onChange={(e) => set({ sendWindowStart: +e.target.value })} />
            </div>
            <div>
              <Label>End hour</Label>
              <Input type="number" min={1} max={24} value={s.sendWindowEnd} onChange={(e) => set({ sendWindowEnd: +e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={s.sendDays.includes(i)}
                  onChange={(e) => set({ sendDays: e.target.checked ? [...s.sendDays, i].sort() : s.sendDays.filter((x) => x !== i) })}
                />
                {d}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label hint="per inbox">Min gap (sec)</Label>
              <Input type="number" min={20} value={s.minGapSeconds} onChange={(e) => set({ minGapSeconds: +e.target.value })} />
            </div>
            <div>
              <Label>Max gap (sec)</Label>
              <Input type="number" min={30} value={s.maxGapSeconds} onChange={(e) => set({ maxGapSeconds: +e.target.value })} />
            </div>
            <div>
              <Label hint="emails/day">Warm-up start</Label>
              <Input type="number" min={1} value={s.warmupStartPerDay} onChange={(e) => set({ warmupStartPerDay: +e.target.value })} />
            </div>
            <div>
              <Label hint="per day">Warm-up increase</Label>
              <Input type="number" min={0} value={s.warmupIncrementPerDay} onChange={(e) => set({ warmupIncrementPerDay: +e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted">
            The app must be running (with your Mac awake) during the send window. With the defaults, a new inbox sends 10 emails on day 1, 15 on day 2, and so on
            up to its daily cap.
          </p>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">AI personalization (optional)</h2>
          <p className="text-sm text-muted">
            Fills <code className="font-mono">{"{{personal_line}}"}</code> with one sentence based on the business&apos;s own website. Ollama runs free on your Mac
            (<code className="font-mono">brew install ollama &amp;&amp; ollama pull llama3.2</code>). Claude costs a fraction of a cent per email.
          </p>
          <Select value={s.aiProvider} onChange={(e) => set({ aiProvider: e.target.value as Settings["aiProvider"] })}>
            <option value="none">Off</option>
            <option value="ollama">Ollama (local, free)</option>
            <option value="anthropic">Claude (Anthropic API)</option>
          </Select>
          {s.aiProvider === "ollama" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ollama URL</Label>
                <Input value={s.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={s.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} />
              </div>
            </div>
          )}
          {s.aiProvider === "anthropic" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label hint={data.secretsFromEnv.anthropicApiKey ? "(set on the server)" : data.secrets.anthropicApiKey ? "(saved)" : ""}>API key</Label>
                <Input
                  type="password"
                  disabled={data.secretsFromEnv.anthropicApiKey}
                  placeholder={data.secrets.anthropicApiKey ? "••••••••  (leave empty to keep)" : "sk-ant-…"}
                  value={keys.anthropicApiKey}
                  onChange={(e) => setKeys({ ...keys, anthropicApiKey: e.target.value })}
                />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={s.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })} />
              </div>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">Data sources & compliance</h2>
          <div>
            <Label hint={data.secretsFromEnv.googlePlacesApiKey ? "(set on the server)" : data.secrets.googlePlacesApiKey ? "(saved)" : "(optional)"}>
              Google Places API key
            </Label>
            <Input
              type="password"
              disabled={data.secretsFromEnv.googlePlacesApiKey}
              placeholder={data.secrets.googlePlacesApiKey ? "••••••••  (leave empty to keep)" : "Adds Google Places as a search source"}
              value={keys.googlePlacesApiKey}
              onChange={(e) => setKeys({ ...keys, googlePlacesApiKey: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted">
              Finds far more businesses than OpenStreetMap, with ratings and review counts, and powers the map-ranking audit. In Google Cloud, enable{" "}
              <b>Places API (New)</b>, create an API key and paste it here. Google needs a billing account, but each kind of request has a free monthly
              allowance.
            </p>
          </div>
          {data.secrets.googlePlacesApiKey && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Google requests this month</div>
              <ul className="space-y-2 text-sm">
                {data.googleUsage.map((u) => (
                  <li key={u.sku}>
                    <div className="flex justify-between">
                      <span>{u.label}</span>
                      <span className="tabular-nums text-muted">
                        {u.used.toLocaleString()}
                        {u.free != null ? ` / ${u.free.toLocaleString()} free` : " · always free"}
                      </span>
                    </div>
                    {u.free != null && <Progress value={(u.used / u.free) * 100} />}
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={s.googleFreeTierOnly}
                  onChange={(e) => set({ googleFreeTierOnly: e.target.checked })}
                />
                <span>
                  Stay within the free allowance
                  <span className="block text-xs text-muted">
                    Stops Google requests when this month&apos;s free allowance is used (counted by BouldLeads; other apps using the same key also count
                    toward Google&apos;s limit). Turn off to keep going at Google&apos;s prices, about $0.02–0.035 per request.
                  </span>
                </span>
              </label>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={s.allowConsentCountries}
              onChange={(e) => set({ allowConsentCountries: e.target.checked })}
            />
            <span>
              Allow leads in Germany and Austria
              <span className="block text-xs text-muted">Off by default: cold B2B email there generally requires prior consent (UWG §7, TKG).</span>
            </span>
          </label>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <div>
            <h2 className="font-semibold">Calling</h2>
            <p className="text-sm text-muted">
              Call first, email second. Leads who don&apos;t pick up get the <b>no-answer follow-up</b> (edit it under Emails); replies and callbacks come
              back to the call list.
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={s.emailOutreach} onChange={(e) => set({ emailOutreach: e.target.checked })} />
            <span>
              <b>Email outreach</b> {s.emailOutreach ? "on" : "off"}
              <span className="block text-xs text-muted">
                Off: BouldLeads is for calls, finding leads and the map only. Nothing is emailed, and the Emails, Replies and Inboxes pages are
                hidden. Turn it on once a sending inbox is connected.
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                disabled={!s.emailOutreach}
                checked={s.followupOnNoAnswer}
                onChange={(e) => set({ followupOnNoAnswer: e.target.checked })}
              />
              <span>
                No answer / Voicemail starts the emails
                <span className="block text-xs text-muted">Off: start them per lead with the button on the lead page.</span>
              </span>
            </label>
            <div>
              <Label hint="(called from your own phones)">Personal list</Label>
              <Select value={s.personalTiers.join(",")} onChange={(e) => set({ personalTiers: e.target.value.split(",") })}>
                <option value="A">Tier A</option>
                <option value="A,B">Tier A + B</option>
              </Select>
              <p className="mt-1 text-xs text-muted">Everything else is the dialer list.</p>
            </div>
            <div>
              <Label hint="(leads per Dialer CSV)">Dialer batch size</Label>
              <Input type="number" min={10} max={5000} value={s.dialerBatchSize} onChange={(e) => set({ dialerBatchSize: Math.max(10, +e.target.value) })} />
              <p className="mt-1 text-xs text-muted">So a day&apos;s dialing never floods the queue.</p>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <div>
            <h2 className="font-semibold">Lead audits</h2>
            <p className="text-sm text-muted">
              Every lead gets the Golden Formula audit: a <b>visibility</b> score out of 20 (Google profile, reviews, map ranking, listings) and a{" "}
              <b>conversion</b> score out of 100 (tap-to-call, quote form, mobile, reviews on site…). Together they give a priority tier, the
              package to pitch, and talking points for the call.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={s.autoAudit} onChange={(e) => set({ autoAudit: e.target.checked })} />
              <span>
                Audit new leads automatically
                <span className="block text-xs text-muted">Runs after the email search. Off: audits run only when you press Audit on a lead.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={s.auditPageSpeed}
                onChange={(e) => set({ auditPageSpeed: e.target.checked })}
              />
              <span>
                PageSpeed for every lead, not just top leads
                <span className="block text-xs text-muted">
                  Tier A/B leads always get a mobile PageSpeed score in their deep audit. This adds it to every lead (20–60 s each). Enable
                  &quot;PageSpeed Insights API&quot; on your Google key for reliable results.
                </span>
              </span>
            </label>
          </div>
        </Card>

        <Card className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Do-not-contact list</h2>
          <p className="text-sm text-muted">Addresses and @domains here are never emailed. Bounces and opt-outs are added automatically.</p>
          <div className="flex gap-2">
            <Textarea rows={2} placeholder="name@company.com, @competitor.com" value={block} onChange={(e) => setBlock(e.target.value)} />
            <Button
              onClick={() =>
                send("/api/suppressions", "POST", { values: block })
                  .then(() => {
                    setBlock("");
                    reloadSupp();
                  })
                  .catch((e) => toast(String(e.message ?? e), "error"))
              }
            >
              Add
            </Button>
          </div>
          <ul className="max-h-64 overflow-y-auto text-sm">
            {supp?.map((x) => (
              <li key={x.value} className="flex items-center gap-3 border-b border-border/60 py-1.5 last:border-0">
                <span className="font-mono text-xs">{x.value}</span>
                <span className="text-xs text-muted">{x.reason}</span>
                <span className="ml-auto text-xs text-muted">{ago(x.created_at)}</span>
                {x.reason === "manual" && (
                  <button className="text-xs text-red-600" onClick={() => send(`/api/suppressions?value=${encodeURIComponent(x.value)}`, "DELETE").then(reloadSupp)}>
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Deleted leads</h2>
          <p className="text-sm text-muted">
            {dismissed?.count
              ? `${fmt(dismissed.count)} deleted businesses are skipped when you search their areas again (you ticked "don't add back" when deleting).`
              : "When you delete leads with \"don't add back\" ticked, searches skip those businesses. None are being skipped right now."}
          </p>
          {!!dismissed?.count && (
            <Button
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: `Allow ${fmt(dismissed.count)} deleted businesses back?`,
                    body: "They won't reappear by themselves: the next search of those areas will find them again as new leads.",
                    confirmLabel: "Allow them back",
                  }))
                )
                  return;
                await send("/api/dismissed", "DELETE");
                toast("Done. Deleted businesses will show up again in new searches.");
                reloadDismissed();
              }}
            >
              Allow them back in searches
            </Button>
          )}
        </Card>
      </div>
    </>
  );
}
