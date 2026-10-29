"use client";

import { CalendarClock, ChevronDown, ChevronRight, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader, ago, cx } from "@/components/ui";
import { CallActions, LocalTime, useMinute } from "@/components/call-actions";
import { CategoryText } from "@/components/category-label";
import { browserTz } from "@/components/call-counter";
import { useApi } from "@/components/use-api";
import { AskFor } from "@/components/ask-for";
import { SourceBadge } from "@/components/score";
import { WARM_MAX, outcomeLabel } from "@/lib/call-outcomes";

// The follow-up list: every callback someone set, grouped by day ("who am I calling on Monday?"),
// with when it was marked and the note from the call. Log the result right from the list. New requests
// (someone asked us for a check and nobody has called yet) sit on top in their own orange card.

type Row = {
  id: number;
  name: string;
  phone: string | null;
  city: string | null;
  category: string | null;
  category_confirmed: number | null;
  callback_at: number;
  note: string | null;
  overdue: boolean;
  day: string;
  marked_at: number | null;
  marked_by: string | null;
  tz: string | null;
  ask_for: string | null;
  call_outcome: string | null;
  call_attempts: number;
  warm_tries: number;
  lead_source: string | null;
  asked_at: number | null;
};

const DAY = 86_400_000;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const short = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// "2026-10-19" → local Date at noon (safe from DST edges)
const dateOf = (day: string) => new Date(`${day}T12:00:00`);
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dayTitle(day: string, today: string) {
  const diff = Math.round((dateOf(day).getTime() - dateOf(today).getTime()) / DAY);
  const date = dateOf(day).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : date;
}

function Item({ r, onDone }: { r: Row; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {r.asked_at != null ? (
          <span className="w-20 shrink-0 font-semibold tabular-nums text-orange-700 dark:text-orange-300" title={`Asked ${short(r.asked_at)}`}>
            {ago(r.asked_at)}
          </span>
        ) : (
          <span className={cx("w-20 shrink-0 font-semibold tabular-nums", r.overdue && "text-yellow-700 dark:text-yellow-300")}>{time(r.callback_at)}</span>
        )}
        <Link href={`/leads/${r.id}`} className="min-w-0 font-medium hover:text-accent hover:underline">
          {r.name}
        </Link>
        {r.asked_at != null && <SourceBadge source={r.lead_source} />}
        <span className="text-xs text-muted">
          <CategoryText category={r.category} confirmed={r.category_confirmed} />
          {r.city && ` · ${r.city}`}
        </span>
        <span className="text-xs">
          <LocalTime tz={r.tz} />
        </span>
        <span className="ml-auto flex items-center gap-3">
          {r.phone && (
            <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Phone size={12} /> {r.phone}
            </a>
          )}
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Log call
          </button>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted sm:pl-23">
        <AskFor id={r.id} value={r.ask_for} />
        <span>
          · {r.call_attempts} call{r.call_attempts === 1 ? "" : "s"} · last: {outcomeLabel(r.call_outcome)}
          {r.warm_tries > 0 && ` · try ${r.warm_tries + 1} of ${WARM_MAX}`}
        </span>
        {r.marked_at && (
          <span>
            · Marked {short(r.marked_at)}
            {r.marked_by && ` by ${r.marked_by}`}
          </span>
        )}
        {r.note && <span className="text-foreground/80">· “{r.note}”</span>}
      </div>
      {open && (
        <div className="mt-2 sm:pl-23">
          <CallActions lead={{ id: r.id, name: r.name, email: null, status: "", call_outcome: r.call_outcome }} onDone={onDone} layout="row" />
        </div>
      )}
    </li>
  );
}

export default function CallbacksPage() {
  const { data, reload } = useApi<Row[]>(`/api/calls/schedule?${new URLSearchParams({ tz: browserTz() })}`, 30_000);
  const minute = useMinute();
  const today = minute ? keyOf(new Date(minute * 60_000)) : "";
  const requests = (data ?? []).filter((r) => r.asked_at != null);
  const rows = (data ?? []).filter((r) => r.asked_at == null);
  const overdue = rows.filter((r) => r.overdue && r.day < today);
  const upcoming = rows.filter((r) => !(r.overdue && r.day < today));
  const days = [...new Set(upcoming.map((r) => r.day))];

  // Two-week strip: how many callbacks each day.
  const strip = today
    ? Array.from({ length: 14 }, (_, i) => {
        const d = dateOf(today);
        d.setDate(d.getDate() + i);
        const k = keyOf(d);
        return { k, d, n: upcoming.filter((r) => r.day === k).length };
      })
    : [];

  return (
    <>
      <PageHeader
        title="Callbacks"
        description="Warm leads, by day: everyone who asked for a callback, or caught you at a bad time. A missed callback stays here and moves to the same time next business day, up to 6 tries. Reminders pop up 5 minutes before."
      />

      {strip.length > 0 && (
        <div className="mb-6 grid grid-cols-7 gap-1.5 sm:grid-cols-14">
          {strip.map(({ k, d, n }) => (
            <a
              key={k}
              href={n ? `#day-${k}` : undefined}
              className={cx(
                "rounded-lg border px-1 py-2 text-center text-xs",
                n ? "border-yellow-400/60 bg-yellow-50 hover:border-yellow-500 dark:bg-yellow-950/40" : "border-border text-muted",
                k === today && "ring-1 ring-accent",
              )}
            >
              <div className="font-medium">{d.toLocaleDateString([], { weekday: "short" })}</div>
              <div className="text-muted">{d.getDate()}</div>
              <div className={cx("mt-1 text-sm font-semibold tabular-nums", !n && "opacity-30")}>{n || "·"}</div>
            </a>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <Card className="mb-4 border-orange-400 dark:border-orange-700">
          <h2 className="flex flex-wrap items-baseline gap-2 font-semibold text-orange-700 dark:text-orange-300">
            New requests ({requests.length})
            <span className="text-xs font-normal text-muted">They asked us for a check: call within the hour</span>
          </h2>
          <ul className="divide-y divide-border/60">
            {requests.map((r) => (
              <Item key={r.id} r={r} onDone={reload} />
            ))}
          </ul>
        </Card>
      )}

      {data && rows.length === 0 && requests.length === 0 && (
        <Card className="text-center text-sm text-muted">
          <CalendarClock size={20} className="mx-auto mb-2 opacity-60" />
          No callbacks scheduled. On a call, tap <b>Call back</b> and pick a time: it lands here.
        </Card>
      )}

      {overdue.length > 0 && (
        <Card className="mb-4 border-yellow-400 dark:border-yellow-700">
          <h2 className="font-semibold text-yellow-700 dark:text-yellow-300">Overdue ({overdue.length})</h2>
          <ul className="divide-y divide-border/60">
            {overdue.map((r) => (
              <Item key={r.id} r={r} onDone={reload} />
            ))}
          </ul>
        </Card>
      )}

      {days.map((day) => {
        const list = upcoming.filter((r) => r.day === day);
        return (
          <Card key={day} className="mb-4 scroll-mt-4">
            <h2 id={`day-${day}`} className="flex items-baseline gap-2 font-semibold">
              {today ? dayTitle(day, today) : day}
              <span className="text-xs font-normal text-muted">
                {list.length} callback{list.length === 1 ? "" : "s"}
              </span>
            </h2>
            <ul className="divide-y divide-border/60">
              {list.map((r) => (
                <Item key={r.id} r={r} onDone={reload} />
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}
