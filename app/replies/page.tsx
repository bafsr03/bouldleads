"use client";

import Link from "next/link";
import { Phone } from "lucide-react";
import { Card, PageHeader, StatusBadge, ago } from "@/components/ui";
import { useApi } from "@/components/use-api";

type Reply = {
  id: number;
  kind: string;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: number;
  name: string;
  business_id: number;
  phone: string | null;
  website: string | null;
  campaign: string;
};

export default function RepliesPage() {
  const { data } = useApi<Reply[]>("/api/replies", 15_000);
  const replies = data?.filter((r) => r.kind === "reply") ?? [];
  const other = data?.filter((r) => r.kind !== "reply") ?? [];

  return (
    <>
      <PageHeader
        title="Replies"
        description="Replies are detected over IMAP every 5 minutes. Answer them from your normal mail app. Opt-outs and bounces are suppressed automatically."
      />
      <div className="space-y-3">
        {data && replies.length === 0 && <p className="text-sm text-muted">No replies yet.</p>}
        {replies.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/leads/${r.business_id}`} className="font-medium hover:text-accent hover:underline">
                {r.name}
              </Link>
              <span className="font-mono text-xs text-muted">{r.from_email}</span>
              <span className="ml-auto text-xs text-muted">
                {r.campaign} · {ago(r.received_at)}
              </span>
              {r.phone && (
                <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                  <Phone size={12} /> Call {r.phone}
                </a>
              )}
            </div>
            <div className="mt-1 text-sm font-medium">{r.subject}</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.snippet}</p>
          </Card>
        ))}
      </div>

      {other.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-lg font-semibold">Opt-outs & bounces</h2>
          <Card className="p-0">
            <ul>
              {other.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2 text-sm last:border-0">
                  <StatusBadge status={r.kind === "bounce" ? "bounced" : "unsubscribed"} />
                  <Link href={`/leads/${r.business_id}`} className="hover:text-accent">
                    {r.name}
                  </Link>
                  <span className="truncate text-xs text-muted">{r.snippet?.slice(0, 120)}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted">{ago(r.received_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
