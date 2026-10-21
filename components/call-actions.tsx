"use client";

import { CalendarClock, ChevronDown, Clock, Mail } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Input, cx } from "./ui";
import { send } from "./use-api";
import { toast } from "./feedback";
import { useEmailOn } from "./use-flags";
import { CALL_LOGGED } from "./call-counter";
import { CLOSING } from "@/lib/call-outcomes";

// One-tap call dispositions. "No answer" and "Voicemail" also start the email follow-up when the
// lead has an email (Settings → Calling). "Call back" and "Bad timing" ask when; the lead stays warm
// in Callbacks. Outcomes that close a lead take a second tap. An optional note goes with any call.

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function at(daysAhead: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export type CallLead = { id: number; name: string; email: string | null; status: string; call_outcome?: string | null };

type Picking = "call_back" | "bad_timing" | null;

export function CallActions({ lead, onDone, layout = "stack" }: { lead: CallLead; onDone: () => void; layout?: "stack" | "row" }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [when, setWhen] = useState(() => toLocalInput(at(1, 10)));
  const moreRef = useRef<HTMLDivElement>(null);
  const emailOn = useEmailOn();
  const canEmail = !!emailOn && !!lead.email && lead.status === "verified";

  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMore(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [more]);

  // "Tap again to confirm" expires after 3 seconds.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  async function log(outcome: string, extra: Record<string, unknown> = {}) {
    // Outcomes that close the lead take a second tap: the buttons sit right under the phone number.
    if (CLOSING.includes(outcome) && confirming !== outcome) {
      setConfirming(outcome);
      return;
    }
    setConfirming(null);
    setBusy(outcome);
    try {
      const r = await send<{ call: { followup: string | null; followupError: string | null } | null }>(`/api/leads/${lead.id}`, "PATCH", {
        callOutcome: outcome || null,
        ...(note.trim() && outcome ? { callNote: note.trim() } : {}),
        ...extra,
      });
      const f = r.call;
      const label = OUTCOME_TEXT[outcome] ?? outcome;
      if (f?.followup === "started") toast(`${lead.name}: ${label}. Follow-up email goes out in the next send window.`);
      else if (f?.followup === "skipped" && emailOn) toast(`${lead.name}: ${label}. No emails: ${f.followupError?.replace(/\.$/, "").toLowerCase()}.`, "info");
      else toast(`${lead.name}: ${label}.`);
      setPicking(null);
      setMore(false);
      setNote("");
      window.dispatchEvent(new Event(CALL_LOGGED)); // daily counter + today's to-do refresh
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const schedule = (d: Date) => log(picking ?? "call_back", { callbackAt: d.getTime() });
  const toggle = (p: Exclude<Picking, null>) => setPicking((cur) => (cur === p ? null : p));
  const sure = (v: string, label: string) => (confirming === v ? "Tap again to confirm" : label);
  const closingCls = (v: string) => cx(confirming === v && "border-red-500 text-red-700 dark:text-red-400");

  return (
    <div className={cx("flex gap-2", layout === "stack" ? "flex-col" : "flex-wrap items-start")}>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional): who answered, best time…"
        className={cx("h-8 text-xs", layout === "row" && "sm:w-72")}
        maxLength={500}
      />
      <div className={cx("grid gap-2", layout === "stack" ? "grid-cols-2" : "grid-cols-2 sm:flex")}>
        <Button
          size="sm"
          variant="primary"
          disabled={!!busy}
          onClick={() => log("no_answer")}
          title={canEmail ? "Log no answer and start the email follow-up" : "Log no answer: the lead moves to Call again (a warm lead stays in Callbacks)"}
        >
          {canEmail && <Mail size={13} />} No answer
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => log("voicemail")} title={canEmail ? "Left a voicemail (also starts the email follow-up)" : "Left a voicemail"}>
          Voicemail
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => toggle("call_back")} className={cx(picking === "call_back" && "border-accent text-accent")}>
          <CalendarClock size={13} /> Call back
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => log("audit_booked")} className="text-emerald-700 dark:text-emerald-400">
          Booked
        </Button>
        <Button
          size="sm"
          disabled={!!busy}
          onClick={() => toggle("bad_timing")}
          className={cx(picking === "bad_timing" && "border-accent text-accent")}
          title="Reached them but they couldn't talk (busy, with a customer): pick when to try again. It stays in Callbacks"
        >
          Bad timing
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => log("hung_up")} title="Picked up and hung up: the lead moves to Call again">
          Hung up
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => log("not_interested")} className={closingCls("not_interested")}>
          {sure("not_interested", "Not interested")}
        </Button>
        <div className="relative" ref={moreRef}>
          <Button size="sm" disabled={!!busy} onClick={() => setMore((m) => !m)} className="w-full">
            More <ChevronDown size={13} />
          </Button>
          {more && (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border bg-surface p-1 text-sm shadow-lg">
              {[
                ["disconnected", "Number disconnected"],
                ["won", "Won: client"],
                ["wrong_number", "Wrong number"],
                ["do_not_call", "Do not call"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => log(v)}
                  className={cx("block w-full rounded-md px-3 py-1.5 text-left hover:bg-background", confirming === v && "font-medium text-red-700 dark:text-red-400")}
                >
                  {sure(v, l)}
                </button>
              ))}
              {lead.call_outcome && (
                <button onClick={() => log("")} className="block w-full rounded-md px-3 py-1.5 text-left text-muted hover:bg-background">
                  Clear status
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {picking && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <Clock size={12} /> {picking === "bad_timing" ? "Bad timing: when should we try again?" : "When should we call back?"}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {picking === "bad_timing" ? (
              <>
                <Button size="sm" onClick={() => schedule(new Date(Date.now() + 3600_000))}>In 1 hour</Button>
                <Button size="sm" onClick={() => schedule(laterToday())}>Later today</Button>
                <Button size="sm" onClick={() => schedule(new Date(Date.now() + 86_400_000))}>Tomorrow, same time</Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => schedule(new Date(Date.now() + 2 * 3600_000))}>In 2 hours</Button>
                <Button size="sm" onClick={() => schedule(at(1, 10))}>Tomorrow 10:00</Button>
                <Button size="sm" onClick={() => schedule(at(7, 10))}>Next week</Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-8" />
            <Button size="sm" variant="primary" disabled={!when} onClick={() => schedule(new Date(when))}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Later today": 4 pm, or 3 hours from now if it's already past 1 pm. */
function laterToday() {
  const d = new Date();
  if (d.getHours() < 13) d.setHours(16, 0, 0, 0);
  else d.setTime(d.getTime() + 3 * 3600_000);
  return d;
}

const OUTCOME_TEXT: Record<string, string> = {
  "": "status cleared",
  no_answer: "no answer",
  voicemail: "voicemail left",
  call_back: "callback scheduled",
  audit_booked: "audit booked",
  hung_up: "hung up, moved to Call again",
  bad_timing: "bad timing, callback scheduled",
  won: "marked as won",
  not_interested: "not interested",
  wrong_number: "wrong number",
  disconnected: "number disconnected, removed from the call list",
  do_not_call: "do not call: calls and emails stopped",
};

/** "10:42 local" in the business's time zone; amber outside business hours or on weekends. */
// Current minute, re-rendering every 30 s; null on the server so markup doesn't mismatch.
const subscribeMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
export const useMinute = () => useSyncExternalStore(subscribeMinute, () => Math.floor(Date.now() / 60_000), () => 0);

export function LocalTime({ tz }: { tz: string | null | undefined }) {
  const minute = useMinute();
  if (!tz || !minute) return null;
  const now = new Date(minute * 60_000);
  let time = "";
  let hour = 12;
  let day = "";
  try {
    time = now.toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit" });
    hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
    day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  } catch {
    return null;
  }
  const off = hour < 9 || hour >= 18 || day === "Sun";
  return (
    <span
      className={cx("inline-flex items-center gap-1 whitespace-nowrap", off ? "text-amber-700 dark:text-amber-400" : "text-muted")}
      title={off ? "Outside their business hours" : "Their local time"}
    >
      <Clock size={11} />
      {time} local{off && " · closed?"}
    </span>
  );
}
