"use client";

import { Bell, BellRing, CalendarClock, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Card, cx } from "./ui";
import { useApi } from "./use-api";
import { toast } from "./feedback";
import { CALL_LOGGED, browserTz } from "./call-counter";
import { LocalTime, useMinute } from "./call-actions";
import { CategoryText } from "./category-label";
import { WARM_MAX, outcomeLabel } from "@/lib/call-outcomes";

// Today's to-do: callbacks that are overdue or due today, earliest first. useCallbackAlerts() (mounted
// once, in the nav) pops an in-app toast and a desktop notification 5 minutes before each one, while
// BouldLeads is open in a browser tab.

type Item = {
  id: number;
  name: string;
  phone: string | null;
  city: string | null;
  callback_at: number;
  note: string | null;
  overdue: boolean;
  tz: string | null;
  ask_for: string | null;
  category: string | null;
  category_confirmed: number | null;
  call_outcome: string | null;
  call_attempts: number;
  warm_tries: number;
};
export type CallbackCounts = { overdue: number; today: number; scheduled: number };
type Agenda = { items: Item[]; tomorrow: number; counts: CallbackCounts };

/** The one way every screen counts callbacks: "2 overdue · 3 today · 13 scheduled". */
export function countsText(c: CallbackCounts) {
  const parts = [c.overdue && `${c.overdue} overdue`, c.today && `${c.today} today`, `${c.scheduled} scheduled`].filter(Boolean);
  return parts.join(" · ");
}

const agendaUrl = () => `/api/calls/agenda?${new URLSearchParams({ tz: browserTz() })}`;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const when = (ms: number, nowMs: number) => {
  const sameDay = new Date(ms).toDateString() === new Date(nowMs).toDateString();
  return sameDay ? time(ms) : new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Callback counts (overdue / today / scheduled), shared by the nav badge, Call list and Today's to-do. */
export function useCallbackCounts(enabled = true): CallbackCounts | null {
  return useAgenda(enabled).data?.counts ?? null;
}

function useAgenda(enabled = true) {
  const api = useApi<Agenda>(enabled ? agendaUrl() : null, 60_000);
  const { reload } = api;
  useEffect(() => {
    window.addEventListener(CALL_LOGGED, reload);
    return () => window.removeEventListener(CALL_LOGGED, reload);
  }, [reload]);
  return api;
}

// Desktop notification permission, re-read after the user answers the prompt.
const permListeners = new Set<() => void>();
const readPerm = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
function useNotificationPermission() {
  return useSyncExternalStore(
    (cb) => (permListeners.add(cb), () => permListeners.delete(cb)),
    readPerm,
    () => "unsupported",
  );
}
async function askPermission() {
  if (typeof Notification === "undefined") return;
  await Notification.requestPermission();
  permListeners.forEach((cb) => cb());
}

const FIRED_KEY = "bouldleads:callback-alerts";
function fired(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function markFired(key: string) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired(), key].slice(-200)));
  } catch {}
}

const LEAD_MS = 5 * 60_000; // alert 5 minutes before
const STALE_MS = 15 * 60_000; // don't alert for callbacks that were due long before the tab opened

/** Toast + desktop notification for each callback as it comes due. Mount once. Returns the callback counts. */
export function useCallbackAlerts(enabled: boolean): CallbackCounts | null {
  const { data } = useAgenda(enabled);
  const minute = useMinute();
  const router = useRouter();
  useEffect(() => {
    if (!data || !minute) return;
    const nowMs = minute * 60_000;
    const done = new Set(fired());
    for (const it of data.items) {
      const key = `${it.id}:${it.callback_at}`;
      if (done.has(key) || it.callback_at - LEAD_MS > nowMs || it.callback_at < nowMs - STALE_MS) continue;
      markFired(key);
      const text = `Callback ${it.callback_at > nowMs ? `at ${time(it.callback_at)}` : "now"}: ${it.name}`;
      toast(`${text}${it.phone ? ` · ${it.phone}` : ""}`, "info");
      if (readPerm() === "granted") {
        try {
          const n = new Notification(text, { body: [it.phone, it.note].filter(Boolean).join(" · ") || undefined, tag: key });
          n.onclick = () => {
            window.focus();
            router.push(`/leads/${it.id}`);
          };
        } catch {}
      }
    }
  }, [data, minute, router]);
  return data?.counts ?? null;
}

/** "Today's to-do" card: Overview and Call list. */
export function TodayAgenda({ className }: { className?: string }) {
  const { data } = useAgenda();
  const perm = useNotificationPermission();
  const minute = useMinute();
  const [hideAsk, setHideAsk] = useState(false);
  if (!data) return null;
  const nowMs = minute * 60_000;
  return (
    <Card className={cx("p-4", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="inline-flex items-center gap-1.5 font-semibold">
          <CalendarClock size={15} className="text-yellow-600 dark:text-yellow-400" /> Today&apos;s to-do
        </h2>
        <span className="text-xs text-muted">
          {data.items.length ? countsText(data.counts) : `No callbacks due today · ${data.counts.scheduled} scheduled`}
          {data.tomorrow ? ` · ${data.tomorrow} tomorrow` : ""}
        </span>
        <Link href="/callbacks" className="text-xs text-accent hover:underline">
          All callbacks →
        </Link>
        {perm === "default" && !hideAsk && (
          <Button size="sm" className="ml-auto" onClick={() => (askPermission(), setHideAsk(true))} title="Pop-up reminders while BouldLeads is open in a tab">
            <Bell size={13} /> Turn on desktop alerts
          </Button>
        )}
        {perm === "granted" && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted" title="You get a pop-up 5 minutes before each callback while BouldLeads is open in a tab">
            <BellRing size={12} /> Alerts on
          </span>
        )}
      </div>
      {data.items.length > 0 && (
        <ul className="divide-y divide-border/60">
          {data.items.map((it) => {
            const late = !!nowMs && it.callback_at < nowMs;
            return (
              <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className={cx("w-28 shrink-0 font-medium tabular-nums", late ? "text-yellow-700 dark:text-yellow-300" : "")}>
                  {nowMs ? when(it.callback_at, nowMs) : ""}
                  {late && <span className="ml-1 text-xs font-normal">overdue</span>}
                </span>
                <Link href={`/leads/${it.id}`} className="min-w-0 font-medium hover:text-accent hover:underline">
                  {it.name}
                </Link>
                <span className="text-xs text-muted">
                  <CategoryText category={it.category} confirmed={it.category_confirmed} />
                  {it.city && ` · ${it.city}`}
                </span>
                <span className="text-xs">
                  <LocalTime tz={it.tz} />
                </span>
                {it.phone && (
                  <a href={`tel:${it.phone.replace(/[^\d+]/g, "")}`} className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
                    <Phone size={12} /> {it.phone}
                  </a>
                )}
                <p className="w-full truncate pl-0 text-xs text-muted sm:pl-31">
                  {it.ask_for && <b className="text-foreground">Ask for: {it.ask_for} · </b>}
                  {it.call_attempts} call{it.call_attempts === 1 ? "" : "s"} · last: {outcomeLabel(it.call_outcome)}
                  {it.warm_tries > 0 && ` · try ${it.warm_tries + 1} of ${WARM_MAX}`}
                  {it.note && ` · “${it.note}”`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
