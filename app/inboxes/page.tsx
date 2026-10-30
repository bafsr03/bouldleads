"use client";

import { useState } from "react";
import { Badge, Button, Card, Input, Label, Notice, PageHeader, Progress, Select, fmt } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { confirmDialog, toast } from "@/components/feedback";

type Inbox = {
  id: number;
  label: string;
  from_name: string;
  email: string;
  smtp_host: string;
  imap_host: string | null;
  daily_cap: number;
  warmup_enabled: number;
  warmup_start: number;
  sent_today: number;
  sent_date: string | null;
  allowed_today: number;
  total_sent: number;
  last_error: string | null;
  active: number;
};

type Dns = { domain: string; mx: string[]; spf: string | null; dmarc: string | null; dkim: { selector: string }[]; ok: boolean };

const PRESETS: Record<string, { title: string; smtpHost: string; smtpPort: number; smtpSecure: boolean; imapHost: string; imapPort: number | ""; help: string }> = {
  google: {
    title: "Google Workspace / Gmail",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    help: "Turn on 2-step verification, then create an App Password (Google Account → Security → App passwords) and use it as the password.",
  },
  zoho: {
    title: "Zoho Mail (custom domain)",
    smtpHost: "smtppro.zoho.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imappro.zoho.com",
    imapPort: 993,
    help: "Enable IMAP in Zoho Mail settings. If you use 2FA, create an application-specific password. EU accounts use smtppro.zoho.eu / imappro.zoho.eu.",
  },
  outlook: {
    title: "Microsoft 365 / Outlook",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    help: "Your admin must enable 'Authenticated SMTP' for the mailbox.",
  },
  mailpit: {
    title: "Mailpit (local testing)",
    smtpHost: "localhost",
    smtpPort: 1025,
    smtpSecure: false,
    imapHost: "",
    imapPort: "",
    help: "Catches emails locally so you can test without sending anything. Install with brew install mailpit, run mailpit, then open http://localhost:8025.",
  },
  custom: { title: "Other SMTP/IMAP", smtpHost: "", smtpPort: 465, smtpSecure: true, imapHost: "", imapPort: 993, help: "" },
};

const blank = { preset: "google", label: "", fromName: "", email: "", username: "", password: "", dailyCap: 40, warmupEnabled: true, ...PRESETS.google };

export default function InboxesPage() {
  const { data: inboxes, reload } = useApi<Inbox[]>("/api/inboxes", 30_000);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [dns, setDns] = useState<Record<string, Dns | "loading">>({});

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const payload = () => ({ ...form, imapHost: form.imapHost || null, imapPort: form.imapPort || null, imapSecure: true });

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const r = await send<{ smtp: string; imap: string }>("/api/inboxes/test", "POST", payload());
      const ok = r.smtp === "ok" && (r.imap === "ok" || r.imap === "not configured");
      setResult({ tone: ok ? "green" : "red", text: `SMTP: ${r.smtp} · IMAP: ${r.imap}` });
    } catch (e) {
      setResult({ tone: "red", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await send("/api/inboxes", "POST", payload());
      setForm(blank);
      setOpen(false);
      toast("Inbox added. It will warm up gradually.");
      setResult(null);
      reload();
    } catch (e) {
      setResult({ tone: "red", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function checkDns(domain: string) {
    setDns((d) => ({ ...d, [domain]: "loading" }));
    const r = await fetch(`/api/dns?domain=${domain}`).then((r) => r.json());
    setDns((d) => ({ ...d, [domain]: r }));
  }

  const totalCapacity = (inboxes ?? []).filter((i) => i.active).reduce((s, i) => s + i.allowed_today, 0);

  return (
    <>
      <PageHeader
        title="Inboxes"
        description="Sending mailboxes. Use a separate domain for outreach (e.g. bouldhq-mail.com) so your main domain's reputation is protected. Each inbox warms up gradually and is capped per day."
        actions={
          <Button variant="primary" onClick={() => setOpen(!open)}>
            {open ? "Close" : "Add inbox"}
          </Button>
        }
      />

      {inboxes && inboxes.length > 0 && (
        <div className="mb-6">
          <Notice tone="blue">
            Today&apos;s total sending capacity: <b>{fmt(totalCapacity)}</b> emails. At full warm-up, 10,000 emails take about{" "}
            <b>{Math.ceil(10000 / Math.max(1, (inboxes ?? []).filter((i) => i.active).reduce((s, i) => s + i.daily_cap, 0)) / 5 * 7)}</b> days
            (weekdays only).
          </Notice>
        </div>
      )}

      {open && (
        <Card className="mb-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Provider</Label>
              <Select value={form.preset} onChange={(e) => set({ preset: e.target.value, ...PRESETS[e.target.value] })}>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Email address</Label>
              <Input value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="alex@bouldhq-mail.com" />
            </div>
            <div>
              <Label>Sender name</Label>
              <Input value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Alex from BouldHQ" />
            </div>
            <div>
              <Label hint="(defaults to email)">Username</Label>
              <Input value={form.username} onChange={(e) => set({ username: e.target.value })} />
            </div>
            <div>
              <Label hint="(app password)">Password</Label>
              <Input type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} />
            </div>
            <div>
              <Label hint="(max/day after warm-up)">Daily cap</Label>
              <Input type="number" min={1} max={500} value={form.dailyCap} onChange={(e) => set({ dailyCap: +e.target.value })} />
            </div>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Server settings</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <div className="md:col-span-2">
                <Label>SMTP host</Label>
                <Input value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} />
              </div>
              <div>
                <Label>SMTP port</Label>
                <Input type="number" value={form.smtpPort} onChange={(e) => set({ smtpPort: +e.target.value, smtpSecure: +e.target.value === 465 })} />
              </div>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" checked={form.smtpSecure} onChange={(e) => set({ smtpSecure: e.target.checked })} /> SSL (465)
              </label>
              <div className="md:col-span-2">
                <Label hint="(for reply/bounce tracking)">IMAP host</Label>
                <Input value={form.imapHost} onChange={(e) => set({ imapHost: e.target.value })} />
              </div>
              <div>
                <Label>IMAP port</Label>
                <Input type="number" value={form.imapPort} onChange={(e) => set({ imapPort: e.target.value ? +e.target.value : "" })} />
              </div>
              <label className="flex items-end gap-2 pb-2">
                <input type="checkbox" checked={form.warmupEnabled} onChange={(e) => set({ warmupEnabled: e.target.checked })} /> Warm-up
              </label>
            </div>
          </details>
          {PRESETS[form.preset]?.help && <p className="text-xs text-muted">{PRESETS[form.preset].help}</p>}
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
          <div className="flex gap-2">
            <Button onClick={test} disabled={busy || !form.email}>
              Test connection
            </Button>
            <Button variant="primary" onClick={save} disabled={busy || !form.email || !form.fromName}>
              Save inbox
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {inboxes?.length === 0 && !open && <p className="text-sm text-muted">No inboxes yet. Add one to start sending.</p>}
        {inboxes?.map((i) => {
          const domain = i.email.split("@")[1];
          const d = dns[domain];
          const today = i.sent_date === new Date().toLocaleDateString("en-CA") ? i.sent_today : 0;
          return (
            <Card key={i.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{i.email}</span>
                    {i.active ? <Badge tone="green">active</Badge> : <Badge>paused</Badge>}
                    {!i.imap_host && <Badge tone="amber">no IMAP: replies not tracked</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {i.from_name} · {i.smtp_host} · {fmt(i.total_sent)} sent total
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => checkDns(domain)}>
                    Check DNS
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      const r = await send<{ smtp: string; imap: string }>(`/api/inboxes/${i.id}`, "PATCH", { test: true });
                      const ok = r.smtp === "ok" && (r.imap === "ok" || r.imap === "not configured");
                      toast(`SMTP: ${r.smtp} · IMAP: ${r.imap}`, ok ? "success" : "error");
                    }}
                  >
                    Test
                  </Button>
                  <Button size="sm" onClick={() => send(`/api/inboxes/${i.id}`, "PATCH", { active: !i.active }).then(reload)}>
                    {i.active ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Remove ${i.email}?`,
                        body: "Inboxes that already sent email are paused instead, so campaign history stays intact.",
                        confirmLabel: "Remove",
                        danger: true,
                      });
                      if (!ok) return;
                      const r = await send<{ deactivated: boolean }>(`/api/inboxes/${i.id}`, "DELETE");
                      toast(r.deactivated ? "Inbox paused (it has sending history)." : "Inbox removed.");
                      reload();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>Sent today</span>
                    <span>
                      {today} / {i.allowed_today}
                    </span>
                  </div>
                  <Progress value={(today / Math.max(1, i.allowed_today)) * 100} />
                </div>
                <div className="text-xs text-muted">
                  {i.warmup_enabled
                    ? i.allowed_today < i.daily_cap
                      ? `Warming up: ${i.allowed_today}/day now, reaching ${i.daily_cap}/day gradually`
                      : `Fully warmed: ${i.daily_cap}/day`
                    : `Warm-up off: ${i.daily_cap}/day`}
                </div>
                <label className="flex items-center gap-2 text-xs">
                  Daily cap
                  <Input
                    type="number"
                    className="h-7 w-20"
                    defaultValue={i.daily_cap}
                    onBlur={(e) => +e.target.value !== i.daily_cap && send(`/api/inboxes/${i.id}`, "PATCH", { dailyCap: +e.target.value }).then(reload)}
                  />
                </label>
              </div>
              {i.last_error && (
                <div className="mt-3">
                  <Notice tone="red">Last error: {i.last_error}</Notice>
                </div>
              )}
              {d === "loading" && <p className="mt-3 text-xs text-muted">Checking DNS…</p>}
              {d && d !== "loading" && (
                <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
                  {[
                    ["MX", d.mx.length > 0, d.mx[0] ?? "missing"],
                    ["SPF", !!d.spf, d.spf ?? "missing: add a v=spf1 TXT record"],
                    ["DKIM", d.dkim.length > 0, d.dkim.map((k) => k.selector).join(", ") || "not found on common selectors"],
                    ["DMARC", !!d.dmarc, d.dmarc ?? "missing: add _dmarc TXT v=DMARC1; p=none"],
                  ].map(([k, ok, v]) => (
                    <div key={String(k)} className="rounded-lg border border-border p-2">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className={ok ? "text-emerald-600" : "text-red-600"}>{ok ? "✓" : "✕"}</span> {k}
                      </div>
                      <div className="mt-0.5 break-all text-muted">{String(v)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
