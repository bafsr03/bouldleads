"use client";

import { PITCHES } from "@/lib/audit/score";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { BarList } from "@/components/bar-list";
import { Card, Notice, PageHeader, Stat, ago, cx, fmt } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { CallsByDayCard } from "@/components/call-counter";
import { TodayAgenda } from "@/components/today-agenda";

type Stats = {
  businesses: number;
  byStatus: Record<string, number>;
  sent: number;
  sentToday: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  queued: number;
  contacted: number;
  withWebsite: number;
  emailFound: number;
  topTypes: { type: string; found: number; verified: number }[];
  activeCampaigns: number;
  tiers: Record<string, number>;
  outcomes: Record<string, number>;
  auditing: number;
  patterns: { label: string; n: number }[];
  inboxes: number;
  workerOnline: boolean;
  setupDone: boolean;
  stages: Record<string, number>;
  callbacksDue: number;
  emailOutreach: boolean;
};

type Group = { k: string; dials: number; answered: number; leads: number; booked: number; won: number };
type Report = {
  totals: { dials: number; answered: number; leads: number };
  byTier: Group[];
  byType: Group[];
  byPitch: Group[];
  byHour: { hour: number; dials: number; answered: number }[];
  followupSteps: { step: number; sent: number; replied: number }[];
};

const PITCH_NAME: Record<string, string> = { ...PITCHES, unknown: "Before pitch tags" };
const TIER_NAME: Record<string, string> = { A: "Tier A", B: "Tier B", C: "Tier C", not_fit: "Not a fit", unscored: "Not audited" };

function ResultsTable({ rows, name }: { rows: Group[]; name: (k: string) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1.5 pr-3 font-medium" />
            <th className="py-1.5 pr-3 text-right font-medium">Dials</th>
            <th className="py-1.5 pr-3 text-right font-medium">Answered</th>
            <th className="py-1.5 pr-3 text-right font-medium">Booked</th>
            <th className="py-1.5 text-right font-medium">Won</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-border/60">
              <td className="max-w-48 truncate py-1.5 pr-3">{name(r.k)}</td>
              <td className="py-1.5 pr-3 text-right">{fmt(r.dials)}</td>
              <td className="py-1.5 pr-3 text-right">
                {fmt(r.answered)} <span className="text-xs text-muted">{pct(r.answered, r.dials)}</span>
              </td>
              <td className="py-1.5 pr-3 text-right">
                {fmt(r.booked)} <span className="text-xs text-muted">{pct(r.booked, r.leads)}</span>
              </td>
              <td className="py-1.5 text-right">{fmt(r.won)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Event = { id: number; level: string; message: string; created_at: number };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function Overview() {
  const { data: s } = useApi<Stats>("/api/stats", 5000);
  const { data: events } = useApi<Event[]>("/api/events", 10_000);
  const { data: report } = useApi<Report>("/api/report", 30_000);
  const verified = s?.byStatus.verified ?? 0;

  const steps = s
    ? [
        { done: s.setupDone, label: "Add your company name and postal address", href: "/settings" },
        { done: s.businesses > 0, label: "Find businesses in an area", href: "/search" },
        ...(s.emailOutreach ? [{ done: s.inboxes > 0, label: "Connect a sending inbox for the no-answer emails", href: "/inboxes" }] : []),
        { done: (report?.totals.dials ?? 0) > 0, label: "Make your first calls from the call list", href: "/calls" },
      ]
    : [];
  const allDone = steps.length > 0 && steps.every((x) => x.done);

  return (
    <>
      <PageHeader title="Overview" description="From businesses found to calls, emails and booked audits." />

      {s && !s.workerOnline && (
        <div className="mb-6">
          <Notice tone="red">
            Background tasks aren&apos;t running, so nothing is being searched, checked or emailed. Locally, start everything with{" "}
            <code className="font-mono">npm run dev</code>. On the hosted app, check the every-minute cron job (README → Deploy).
          </Notice>
        </div>
      )}

      <TodayAgenda className="mb-6" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Leads found" value={fmt(s?.businesses)} sub={`${fmt(verified)} with a verified email`} />
        <Link href="/calls" className="block">
          <Stat
            label="To call"
            value={fmt(s?.stages.new)}
            sub={s?.callbacksDue ? `${fmt(s.callbacksDue)} callbacks due` : `${fmt((s?.stages.recall ?? 0) + (s?.stages.replied ?? 0))} to call again`}
          />
        </Link>
        <Stat label="Calls made" value={fmt(report?.totals.dials)} sub={`${pct(report?.totals.answered ?? 0, report?.totals.dials ?? 0)} answered`} />
        <Stat label="Booked & won" value={fmt((s?.outcomes.audit_booked ?? 0) + (s?.outcomes.won ?? 0))} sub={`${fmt(s?.outcomes.won)} clients`} />
        <Stat label="Email replies" value={fmt(s?.replied)} sub={`${fmt(s?.sentToday)} emails sent today · ${fmt(s?.queued)} queued`} />
      </div>

      <CallsByDayCard className="mt-6" />

      {report && report.totals.dials > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold">Calls by lead tier</h2>
            <p className="mb-3 text-xs text-muted">Does the audit pick the right people? Answered = any outcome other than no answer, voicemail, wrong or disconnected number.</p>
            <ResultsTable rows={report.byTier} name={(k) => TIER_NAME[k] ?? k} />
          </Card>
          <Card>
            <h2 className="font-semibold">Calls by business type</h2>
            <p className="mb-3 text-xs text-muted">Which industries pick up and book.</p>
            <ResultsTable rows={report.byType} name={(k) => k} />
          </Card>
          <Card>
            <h2 className="font-semibold">Calls by pitch</h2>
            <p className="mb-3 text-xs text-muted">Which pitch books meetings: website, visibility or both. Recorded on each call.</p>
            <ResultsTable rows={report.byPitch ?? []} name={(k) => PITCH_NAME[k] ?? k} />
          </Card>
          <Card>
            <h2 className="font-semibold">Answer rate by hour</h2>
            <p className="mb-4 text-xs text-muted">In each business&apos;s local time. Test early morning, lunch and late afternoon.</p>
            <BarList
              emptyText="Nobody has picked up yet."
              rows={report.byHour.map((h) => ({
                label: `${String(h.hour).padStart(2, "0")}:00`,
                value: h.answered,
                note: `of ${fmt(h.dials)} · ${pct(h.answered, h.dials)}`,
              }))}
            />
          </Card>
          <Card>
            <h2 className="font-semibold">No-answer emails by step</h2>
            <p className="mb-3 text-xs text-muted">Replies to each follow-up email (day 1, 3, 5, 12).</p>
            {report.followupSteps.length === 0 ? (
              <p className="text-sm text-muted">No follow-up emails sent yet.</p>
            ) : (
              <BarList
                emptyText={`${fmt(report.followupSteps.reduce((a, f) => a + f.sent, 0))} sent, no replies yet.`}
                rows={report.followupSteps.map((f) => ({ label: `Email ${f.step + 1}`, value: f.replied, note: `replies of ${fmt(f.sent)} sent · ${pct(f.replied, f.sent)}` }))}
              />
            )}
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Pipeline</h2>
          <p className="mb-4 text-xs text-muted">How many businesses reach each stage, with conversion from the previous stage.</p>
          {s && (
            <BarList
              emptyText="Run your first search to see the pipeline."
              rows={(() => {
                const phones = Object.values(s.stages).reduce((a, b) => a + b, 0);
                const called = report?.totals.leads ?? 0;
                const booked = (s.outcomes.audit_booked ?? 0) + (s.outcomes.won ?? 0);
                return [
                  { label: "Businesses found", value: s.businesses },
                  { label: "Have a phone number", value: phones, note: pct(phones, s.businesses) },
                  { label: "Called", value: called, note: pct(called, phones) },
                  { label: "Audit booked or won", value: booked, note: pct(booked, called) },
                  { label: "Clients", value: s.outcomes.won ?? 0, note: pct(s.outcomes.won ?? 0, booked) },
                ];
              })()}
            />
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">Verified emails by business type</h2>
          <p className="mb-4 text-xs text-muted">Top types in your database. The note shows how many were found in total.</p>
          {s && (
            <BarList
              emptyText={s.businesses ? "No verified emails yet. They appear here as websites are checked." : "No businesses yet."}
              rows={s.topTypes.map((t) => ({ label: t.type, value: t.verified ?? 0, note: `of ${fmt(t.found)}` }))}
            />
          )}
        </Card>

        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Lead quality</h2>
            <Link href="/calls" className="text-xs text-accent hover:underline">
              Open call list
            </Link>
          </div>
          <p className="mb-4 text-xs text-muted">
            Audit tiers: how worth a call each business is.{s?.auditing ? ` ${fmt(s.auditing)} being audited now.` : ""}
          </p>
          {s && (
            <BarList
              emptyText="No audited leads yet. Audits run automatically after each search."
              rows={
                Object.values(s.tiers).some(Boolean)
                  ? [
                      { label: "A · call first", value: s.tiers.A ?? 0 },
                      { label: "B · good lead", value: s.tiers.B ?? 0 },
                      { label: "C · low priority", value: s.tiers.C ?? 0 },
                      { label: "Not a fit", value: s.tiers.not_fit ?? 0 },
                    ]
                  : []
              }
            />
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">What&apos;s holding them back</h2>
          <p className="mb-4 text-xs text-muted">Leads = Visibility × Conversion. The weaker side decides the pitch.</p>
          {s && <BarList emptyText="Appears once leads are audited." rows={s.patterns.map((p) => ({ label: p.label, value: p.n }))} />}
        </Card>

        {!allDone && (
          <Card>
            <h2 className="mb-3 font-semibold">Getting started</h2>
            <ol className="space-y-1">
              {steps.map((st, i) => (
                <li key={i}>
                  <Link href={st.href} className="group flex items-center gap-3 rounded-lg p-2 text-sm hover:bg-background">
                    <span
                      className={cx(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        st.done ? "bg-accent text-white" : "border border-border text-muted",
                      )}
                    >
                      {st.done ? <Check size={13} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={cx("flex-1", st.done && "text-muted line-through")}>{st.label}</span>
                    {!st.done && <ArrowRight size={14} className="text-muted opacity-0 transition-opacity group-hover:opacity-100" />}
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <Card className={cx(allDone && "lg:col-span-2")}>
          <h2 className="mb-3 font-semibold">Activity</h2>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {(events ?? []).length === 0 && <li className="text-muted">No activity yet.</li>}
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex gap-3 border-b border-border/60 py-1.5 last:border-0">
                <span className="w-16 shrink-0 text-xs text-muted">{ago(e.created_at)}</span>
                <span className={cx("min-w-0 break-words", e.level === "error" && "text-red-600", e.level === "warn" && "text-amber-600")}>
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
