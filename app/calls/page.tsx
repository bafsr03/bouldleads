"use client";

import { ArrowRight, Download, Phone, PhoneOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Card, Input, PageHeader, Select, ago, cx, fmt } from "@/components/ui";
import { PitchBadge, Rating, STAGES, ScorePair, SiteChip, TierBadge, followupText, outcomeLabel } from "@/components/score";
import { AskFor } from "@/components/ask-for";
import { WARM_MAX } from "@/lib/call-outcomes";
import { CallActions, LocalTime, useMinute } from "@/components/call-actions";
import { CategoryText } from "@/components/category-label";
import { CallCounter } from "@/components/call-counter";
import { TodayAgenda, countsText, useCallbackCounts } from "@/components/today-agenda";
import { useApi } from "@/components/use-api";
import { useEmailOn } from "@/components/use-flags";

type Row = {
  id: number;
  name: string;
  category: string | null;
  category_confirmed: number | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  visibility_score: number | null;
  conversion_score: number | null;
  priority: number | null;
  tier: string | null;
  call_outcome: string | null;
  called_at: number | null;
  call_attempts: number;
  callback_at: number | null;
  warm_tries: number;
  ask_for: string | null;
  social_url: string | null;
  last_note: string | null;
  stage: string;
  tz: string | null;
  followup: { step: number; steps: number; state: string; nextSendAt: number | null } | null;
  top_issue: string | null;
  verdict: string | null;
  pattern: string | null;
  pitch: string | null;
  site_state: string | null;
  site_label: string | null;
};

const SORT: Record<string, string> = { callback: "callback", booked: "called", closed: "called", recall: "priority" };

function CallsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const stage = sp.get("stage") ?? "new";
  const list = sp.get("list") ?? "";
  const place = sp.get("place") ?? "";
  const type = sp.get("type") ?? "";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [page, setPage] = useState(0);
  const nowMs = useMinute() * 60_000;
  const emailOn = useEmailOn();
  // Without email outreach there are no email replies or follow-ups to show.
  const stages = STAGES.filter((s) => emailOn !== false || (s.value !== "followup" && s.value !== "replied"));

  const { data: settings } = useApi<{ settings: { personalTiers: string[]; dialerBatchSize: number } }>("/api/settings");
  const personal = settings?.settings.personalTiers ?? ["A"];
  const dialerTiers = ["A", "B", "C", "unscored"].filter((t) => !personal.includes(t));
  const tier = list === "personal" ? personal.join(",") : list === "dialer" ? dialerTiers.join(",") : "";

  useEffect(() => {
    const t = setTimeout(() => (setDebounced(q), setPage(0)), 300);
    return () => clearTimeout(t);
  }, [q]);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/calls?${p}`, { scroll: false });
    setPage(0);
  };

  const filters = {
    status: "all",
    phone: "1",
    stage,
    sort: SORT[stage] ?? "priority",
    ...(tier ? { tier } : {}),
    ...(place ? { place } : {}),
    ...(type ? { type } : {}),
    ...(debounced ? { q: debounced } : {}),
  };
  const { data, reload } = useApi<{ total: number; pageSize: number; rows: Row[] }>(`/api/leads?${new URLSearchParams({ ...filters, page: String(page) })}`, 15_000);
  const { data: stats, reload: reloadStats } = useApi<{ stages: Record<string, number>; callbacksDue: number }>("/api/stats", 15_000);
  const { data: types } = useApi<{ type: string; total: number }[]>("/api/leads/types", 60_000);
  const { data: places } = useApi<{ place: string; totals: { with_phone: number } }[]>("/api/places", 60_000);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const exportQs = new URLSearchParams(filters);
  const done = () => (reload(), reloadStats());
  const cbCounts = useCallbackCounts();

  return (
    <>
      <PageHeader
        title="Call list"
        description={
          emailOn === false
            ? "The best leads first, with what to open with. Tap what happened after every call: callbacks come back here when they're due."
            : "Call first. Leads that don't pick up get the email follow-up automatically, and anyone who replies or asks for a callback comes back here."
        }
        actions={
          <>
            <a href={`/api/leads/export?${exportQs}&format=dialer`} title={`Up to ${settings?.settings.dialerBatchSize ?? 200} leads in the columns dialers and CRMs import (WAVV, GoHighLevel)`}>
              <Button>
                <Download size={14} /> Dialer CSV
              </Button>
            </a>
            <a href={`/api/leads/export?${exportQs}`}>
              <Button>Export</Button>
            </a>
          </>
        }
      />

      <CallCounter />
      <TodayAgenda className="mb-4" />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {stages.map((s) => {
          const n = stats?.stages[s.value] ?? 0;
          const due = s.value === "callback" && !!cbCounts && cbCounts.overdue + cbCounts.today > 0;
          return (
            <button
              key={s.value}
              onClick={() => set("stage", s.value === "new" ? "" : s.value)}
              title={s.value === "callback" && cbCounts ? `${s.hint} ${countsText(cbCounts)}` : s.hint}
              className={cx(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                stage === s.value ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {s.label}
              <span
                className={cx(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  due ? "bg-yellow-400 font-semibold text-zinc-900" : stage === s.value ? "bg-accent-soft" : "bg-background",
                )}
              >
                {due ? `${cbCounts!.overdue + cbCounts!.today} due` : fmt(n)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="sm:w-56" value={list} onChange={(e) => set("list", e.target.value)}>
          <option value="">All leads</option>
          <option value="personal">Personal list (tier {personal.join(", ")})</option>
          <option value="dialer">Dialer list (everything else)</option>
        </Select>
        <Select className="sm:w-52" value={place} onChange={(e) => set("place", e.target.value)}>
          <option value="">All places</option>
          {places?.map((p) => (
            <option key={p.place} value={p.place}>
              {p.place}
            </option>
          ))}
        </Select>
        <Select className="sm:w-56" value={type} onChange={(e) => set("type", e.target.value)}>
          <option value="">All business types</option>
          {types?.map((t) => (
            <option key={t.type} value={t.type}>
              {t.type}
            </option>
          ))}
        </Select>
        <Input className="sm:w-56" placeholder="Search name, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="space-y-2">
        {!data && [0, 1, 2].map((i) => <Card key={i} className="h-28 animate-pulse">{null}</Card>)}
        {data && data.rows.length === 0 && (
          <Card className="py-10 text-center text-sm text-muted">
            <PhoneOff className="mx-auto mb-2 text-muted" size={22} />
            {stage === "new" ? (
              <>
                Nobody left to call here. Find more businesses on <Link className="text-accent hover:underline" href="/search">Find leads</Link> (choose{" "}
                <b>Any contact: phone counts</b>), or clear the filters above.
              </>
            ) : (
              <>No leads in “{STAGES.find((s) => s.value === stage)?.label}” right now.</>
            )}
          </Card>
        )}
        {data?.rows.map((r) => {
          const due = !!nowMs && !!r.callback_at && r.callback_at <= nowMs;
          const fu = followupText(r.followup);
          return (
            <Card key={r.id} className={cx("p-4", !!due && "border-yellow-400 dark:border-yellow-600")}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="w-12 shrink-0 text-center">
                  <div className="text-2xl font-semibold tabular-nums">{r.priority ?? "–"}</div>
                  <div className="text-[11px] text-muted">priority</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${r.id}`} className="font-medium hover:text-accent hover:underline">
                      {r.name}
                    </Link>
                    <TierBadge tier={r.tier} short />
                    <PitchBadge pitch={r.pitch} />
                    <SiteChip state={r.site_state} label={r.site_label} website={r.website} socialUrl={r.social_url} />
                    <ScorePair v={r.visibility_score} c={r.conversion_score} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    {r.category && (
                      <span>
                        <CategoryText category={r.category} confirmed={r.category_confirmed} />
                      </span>
                    )}
                    {r.city && <span>· {r.city}</span>}
                    {r.review_count != null && (
                      <span>
                        · <Rating rating={r.rating} count={r.review_count} />
                      </span>
                    )}
                    {!r.email && <span>· no email</span>}
                    <span>
                      · <LocalTime tz={r.tz} />
                    </span>
                  </div>
                  {r.top_issue && (
                    <div className="mt-2 text-sm">
                      <span className="text-muted">Open with: </span>
                      {r.top_issue}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {r.call_attempts > 0 && (
                      <span>
                        {r.call_attempts} call{r.call_attempts === 1 ? "" : "s"} · last: {outcomeLabel(r.call_outcome)} {ago(r.called_at)}
                      </span>
                    )}
                    {r.callback_at && (
                      <span className={cx(!!due && "font-medium text-yellow-700 dark:text-yellow-300")}>
                        Call back {due ? "now · was due " : ""}
                        {new Date(r.callback_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {r.warm_tries > 0 && ` · try ${r.warm_tries + 1} of ${WARM_MAX}`}
                      </span>
                    )}
                    {fu && <span className="text-sky-700 dark:text-sky-400">{fu}</span>}
                  </div>
                  {r.last_note && <p className="mt-1 text-xs text-foreground/80">“{r.last_note}”</p>}
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-72">
                  <a
                    href={`tel:${(r.phone ?? "").replace(/[^\d+]/g, "")}`}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-accent px-3 text-sm font-medium text-accent hover:bg-accent-soft"
                  >
                    <Phone size={14} /> {r.phone}
                  </a>
                  <AskFor id={r.id} value={r.ask_for} className="justify-center" />
                  {/* A little room between the number and the outcomes, so a tap on one doesn't land on the other. */}
                  <div className="mt-1 border-t border-border pt-2">
                    <CallActions lead={r} onDone={done} />
                  </div>
                  <Link href={`/leads/${r.id}`} className="inline-flex items-center justify-end gap-1 text-xs text-muted hover:text-accent">
                    Full audit & call brief <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>{fmt(data?.total)} leads</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              {page + 1} / {pages}
            </span>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export default function CallsPage() {
  return (
    <Suspense>
      <CallsInner />
    </Suspense>
  );
}
