"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Input, PageHeader, Progress, StatusBadge, fmt } from "@/components/ui";
import { send, useApi } from "@/components/use-api";

type Campaign = {
  id: number;
  name: string;
  kind: "campaign" | "followup";
  active_leads: number;
  status: string;
  leads: number;
  sent: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  created_at: number;
};

export default function CampaignsPage() {
  const router = useRouter();
  const { data } = useApi<Campaign[]>("/api/campaigns", 8000);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await send<{ id: number }>("/api/campaigns", "POST", { name });
      router.push(`/campaigns/${r.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Emails"
        description="The no-answer follow-up emails everyone you call but can't reach. Campaigns send a sequence to a list of leads you haven't called. Replies stop follow-ups automatically."
      />
      <Card className="mb-6">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <Input className="max-w-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name, e.g. Austin dentists, Oct" />
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            New campaign
          </Button>
          {err && <span className="self-center text-sm text-red-600">{err}</span>}
        </form>
      </Card>

      <div className="space-y-3">
        {data?.filter((c) => c.kind === "followup").map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
            <Card className="border-accent/40 transition-colors hover:border-accent">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">Starts when a call goes unanswered. Edit the emails and sending inboxes here.</p>
                </div>
                <div className="flex gap-6 text-sm tabular-nums">
                  <span>
                    <b>{fmt(c.active_leads)}</b> <span className="text-muted">in progress</span>
                  </span>
                  <span>
                    <b>{fmt(c.sent)}</b> <span className="text-muted">sent</span>
                  </span>
                  <span>
                    <b>{fmt(c.replied)}</b> <span className="text-muted">replies</span>
                  </span>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        <h2 className="pt-4 text-sm font-semibold uppercase tracking-wide text-muted">Campaigns</h2>
        {data?.filter((c) => c.kind !== "followup").length === 0 && <p className="text-sm text-muted">No campaigns yet.</p>}
        {data?.filter((c) => c.kind !== "followup").map((c) => {
          const rate = (n: number) => (c.sent ? `${((n / c.sent) * 100).toFixed(1)}%` : "—");
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
              <Card className="transition-colors hover:border-accent">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="flex gap-6 text-sm tabular-nums">
                    <span>
                      <b>{fmt(c.leads)}</b> <span className="text-muted">leads</span>
                    </span>
                    <span>
                      <b>{fmt(c.sent)}</b> <span className="text-muted">sent</span>
                    </span>
                    <span>
                      <b>{fmt(c.replied)}</b> <span className="text-muted">replies ({rate(c.replied)})</span>
                    </span>
                    <span>
                      <b>{fmt(c.bounced)}</b> <span className="text-muted">bounced ({rate(c.bounced)})</span>
                    </span>
                  </div>
                </div>
                {c.leads > 0 && (
                  <div className="mt-3">
                    <Progress value={(c.sent / Math.max(1, c.leads)) * 100} />
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
