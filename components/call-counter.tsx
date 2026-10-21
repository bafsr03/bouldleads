"use client";

import { ChevronDown, ChevronRight, PhoneCall } from "lucide-react";
import { useEffect, useState } from "react";
import { OUTCOMES } from "@/lib/call-outcomes";
import { Badge, Card, cx, fmt } from "./ui";
import { useApi } from "./use-api";

// Daily call counter: "Today: 12 calls · 7 no answer · 3 call back · 1 hung up…", plus a per-day log.
// Days are the caller's own days (browser time zone). Refreshes right after a call is logged.

type CallDay = { date: string; dials: number; answered: number; outcomes: Record<string, number> };
type Log = { today: CallDay; days: CallDay[]; user: string | null; loginsOn: boolean };

export const CALL_LOGGED = "bouldleads:call-logged";
export const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

function useCallLog(who: "me" | "all", days = 14) {
  const api = useApi<Log>(`/api/calls/log?${new URLSearchParams({ tz: browserTz(), who, days: String(days) })}`, 30_000);
  const { reload } = api;
  useEffect(() => {
    window.addEventListener(CALL_LOGGED, reload);
    return () => window.removeEventListener(CALL_LOGGED, reload);
  }, [reload]);
  return api;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const dayLabel = (date: string, today: string) => {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00`);
  const y = new Date(`${today}T12:00:00`);
  if (Math.round((y.getTime() - d.getTime()) / 86_400_000) === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

function WhoToggle({ who, setWho }: { who: "me" | "all"; setWho: (w: "me" | "all") => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
      {(["me", "all"] as const).map((w) => (
        <button key={w} onClick={() => setWho(w)} className={cx("rounded px-2 py-0.5", who === w ? "bg-accent-soft font-medium" : "text-muted hover:text-foreground")}>
          {w === "me" ? "Me" : "Team"}
        </button>
      ))}
    </div>
  );
}

/** Table of calls per day, one column per outcome that happened. */
export function CallDaysTable({ days, today }: { days: CallDay[]; today: string }) {
  const used = OUTCOMES.filter((o) => days.some((d) => d.outcomes[o.value]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Day</th>
            <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
            <th className="py-1.5 pr-3 text-right font-medium">Answered</th>
            {used.map((o) => (
              <th key={o.value} className="whitespace-nowrap py-1.5 pr-3 text-right font-medium">
                {o.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className="border-t border-border/60">
              <td className="whitespace-nowrap py-1.5 pr-3">{dayLabel(d.date, today)}</td>
              <td className="py-1.5 pr-3 text-right font-medium">{fmt(d.dials)}</td>
              <td className="py-1.5 pr-3 text-right">
                {fmt(d.answered)} <span className="text-xs text-muted">{pct(d.answered, d.dials)}</span>
              </td>
              {used.map((o) => (
                <td key={o.value} className="py-1.5 pr-3 text-right">
                  {d.outcomes[o.value] ? fmt(d.outcomes[o.value]) : <span className="text-muted">·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Today's numbers as a strip (Call list), with the daily log one click away. */
export function CallCounter() {
  const [who, setWho] = useState<"me" | "all">("me");
  const [open, setOpen] = useState(false);
  const { data } = useCallLog(who);
  if (!data) return null;
  const t = data.today;
  const chips = OUTCOMES.filter((o) => t.outcomes[o.value]);
  return (
    <Card className="mb-4 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <PhoneCall size={14} className="text-accent" />
          Today: {fmt(t.dials)} {t.dials === 1 ? "call" : "calls"}
        </span>
        {t.dials > 0 && <span className="text-xs text-muted">{pct(t.answered, t.dials)} answered</span>}
        <span className="flex flex-wrap gap-1.5">
          {chips.map((o) => (
            <Badge key={o.value} tone={o.tone}>
              {t.outcomes[o.value]} {o.label.toLowerCase()}
            </Badge>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {data.loginsOn && <WhoToggle who={who} setWho={setWho} />}
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Daily log
          </button>
        </span>
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-2">
          {data.days.some((d) => d.dials) ? (
            <CallDaysTable days={data.days} today={t.date} />
          ) : (
            <p className="text-sm text-muted">No calls logged in the last 14 days.</p>
          )}
        </div>
      )}
    </Card>
  );
}

/** "Calls by day" card for the Overview. */
export function CallsByDayCard({ className }: { className?: string }) {
  const [who, setWho] = useState<"me" | "all">("all");
  const { data } = useCallLog(who);
  if (!data || !data.days.some((d) => d.dials)) return null;
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Calls by day</h2>
          <p className="mb-3 text-xs text-muted">Last 14 days, in your time zone. Answered = anything but no answer, voicemail, wrong or disconnected number.</p>
        </div>
        {data.loginsOn && <WhoToggle who={who} setWho={setWho} />}
      </div>
      <CallDaysTable days={data.days.filter((d) => d.dials || d.date === data.today.date)} today={data.today.date} />
    </Card>
  );
}
