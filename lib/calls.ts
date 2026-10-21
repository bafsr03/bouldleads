import tzlookup from "tz-lookup";
import { db, logEvent, now } from "./db";
import { getSettings } from "./settings";
import { isSuppressed, suppress } from "./outreach/suppression";
import { FOLLOWUP_STEPS } from "./outreach/templates";
import type { CampaignRow } from "./outreach/campaigns";

// Call-first outreach: every call ends with a disposition, and each disposition has a fixed action.
//   No answer / Voicemail → email follow-up (day 1, 3, 5, 12)   Call back / Bad timing → set a callback (warm)
//   Booked / Won / Not interested → stop emails                    Do not call → stop everything, suppress the email
//   Wrong number / Number disconnected → mark the phone bad (emails continue if there is an address)

export { OUTCOMES, STAGES, isOutcome, type Outcome } from "./call-outcomes";
import { BAD_PHONE, NOT_REACHED, OUTCOMES, WARM_MAX, WARM_RETRY, type Outcome } from "./call-outcomes";

const STOPS_EMAIL: Outcome[] = ["call_back", "audit_booked", "won", "not_interested", "do_not_call"];

/**
 * Where a lead is in the call-first flow. SQL expression over the `businesses` table (unaliased).
 *   new → never called · callback → warm: a callback is set (asked to call back, bad timing) · followup → in the no-answer email sequence
 *   replied → answered an email: call them · recall → no answer and emails finished: call again
 *   booked → audit booked or won · closed → not interested / do not call
 */
export const STAGE_SQL = `CASE
  WHEN businesses.dnc = 1 OR businesses.phone_bad = 1
    OR businesses.call_outcome IN ('not_interested', 'do_not_call', 'wrong_number', 'disconnected') THEN 'closed'
  WHEN businesses.call_outcome IN ('audit_booked', 'won') THEN 'booked'
  WHEN EXISTS (SELECT 1 FROM campaign_leads x WHERE x.business_id = businesses.id AND x.state = 'replied') THEN 'replied'
  WHEN businesses.callback_at IS NOT NULL THEN 'callback'
  WHEN EXISTS (SELECT 1 FROM campaign_leads x JOIN campaigns c ON c.id = x.campaign_id
               WHERE x.business_id = businesses.id AND c.kind = 'followup' AND x.state IN ('queued', 'in_sequence')) THEN 'followup'
  WHEN businesses.call_outcome IS NOT NULL THEN 'recall'
  ELSE 'new' END`;

/** The always-on "No-answer follow-up" sequence. Created on first use with every active inbox. */
export async function followupCampaign(): Promise<CampaignRow> {
  const existing = await db.get<CampaignRow>("SELECT * FROM campaigns WHERE kind = 'followup' ORDER BY id LIMIT 1");
  if (existing) return existing;
  const inboxes = (await db.all<{ id: number }>("SELECT id FROM inboxes WHERE active = 1")).map((r) => r.id);
  await db.run(
    `INSERT INTO campaigns (name, steps, inbox_ids, lead_filter, status, kind, created_at, launched_at)
     VALUES ('No-answer follow-up', ?, ?, '{}', 'active', 'followup', ?, ?)`,
    JSON.stringify(FOLLOWUP_STEPS),
    JSON.stringify(inboxes),
    now(),
    now(),
  );
  return (await db.get<CampaignRow>("SELECT * FROM campaigns WHERE kind = 'followup' ORDER BY id LIMIT 1"))!;
}

export type FollowupState = {
  state: string; // queued | in_sequence | completed | replied | bounced | unsubscribed | stopped | …
  step: number; // emails sent so far
  steps: number;
  nextSendAt: number | null;
};

export async function followupFor(businessId: number): Promise<FollowupState | null> {
  const r = await db.get<{ state: string; step: number; next_send_at: number; steps: string }>(
    `SELECT cl.state, cl.step, cl.next_send_at, c.steps FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
     WHERE cl.business_id = ? AND c.kind = 'followup' ORDER BY cl.id DESC LIMIT 1`,
    businessId,
  );
  if (!r) return null;
  const active = r.state === "queued" || r.state === "in_sequence";
  return { state: r.state, step: r.step, steps: (JSON.parse(r.steps) as unknown[]).length, nextSendAt: active ? r.next_send_at : null };
}

type Lead = { id: number; name: string; email: string | null; status: string; dnc: number };

/** Why this lead can't get follow-up emails, or null if it can. */
export async function cannotFollowUp(b: Lead): Promise<string | null> {
  if (b.dnc) return "Marked do not contact.";
  if (!b.email) return "No email address found for this business.";
  if (b.status === "invalid") return "The email address didn't pass verification.";
  if (b.status === "excluded" || (await isSuppressed(b.email))) return "This address is excluded or unsubscribed.";
  return null;
}

/** Put a lead in the no-answer follow-up. Returns an error message, or null when it's queued. */
export async function startFollowup(businessId: number): Promise<string | null> {
  if (!(await getSettings()).emailOutreach) return "Email outreach is turned off (Settings → Email outreach).";
  const b = await db.get<Lead>("SELECT id, name, email, status, dnc FROM businesses WHERE id = ?", businessId);
  if (!b) return "Lead not found.";
  const why = await cannotFollowUp(b);
  if (why) return why;
  const c = await followupCampaign();
  const cur = await db.get<{ id: number; state: string; step: number }>(
    "SELECT id, state, step FROM campaign_leads WHERE campaign_id = ? AND business_id = ?",
    c.id,
    businessId,
  );
  if (cur) {
    if (cur.state === "queued" || cur.state === "in_sequence") return null; // already running
    if (cur.state !== "stopped") return `Already emailed (${cur.state.replace("_", " ")}).`;
    // Stopped earlier (e.g. a callback): pick up where it left off.
    await db.run(
      "UPDATE campaign_leads SET state = ?, next_send_at = ?, updated_at = ? WHERE id = ?",
      cur.step > 0 ? "in_sequence" : "queued",
      now(),
      now(),
      cur.id,
    );
    return null;
  }
  await db.run(
    `INSERT OR IGNORE INTO campaign_leads (campaign_id, business_id, email, next_send_at, state, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
    c.id,
    businessId,
    b.email!.toLowerCase(),
    now(),
    now(),
  );
  return null;
}

/** Stop every pending email to this lead (follow-up and campaigns). */
export async function stopEmails(businessId: number) {
  await db.run(
    "UPDATE campaign_leads SET state = 'stopped', updated_at = ? WHERE business_id = ? AND state IN ('queued', 'in_sequence')",
    now(),
    businessId,
  );
}

export type CallResult = { followup: "started" | "skipped" | null; followupError: string | null };

/**
 * The same time on the next business day after `from` (Mon-Sat in the lead's time zone), at least an
 * hour from now: when a warm lead didn't pick up, try again at the hour they picked.
 */
export function nextTry(from: number, t: number, tz: string | null): number {
  let at = from;
  const weekday = (ms: number) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC", weekday: "short" }).format(new Date(ms));
    } catch {
      return new Date(ms).toUTCString().slice(0, 3);
    }
  };
  do at += 86_400_000;
  while (at < t + 3_600_000 || weekday(at) === "Sun");
  return at;
}

function leadTz(lat: number | null, lng: number | null): string | null {
  try {
    return lat != null && lng != null ? tzlookup(lat, lng) : null;
  } catch {
    return null;
  }
}

/**
 * Record a call and apply its action. `outcome: null` clears the current disposition (history is kept).
 * A lead with a callback set is warm: a miss (no answer, voicemail, hung up) keeps it in Callbacks and
 * moves the callback to the same time on the next business day, up to WARM_MAX misses.
 */
export async function logCall(
  businessId: number,
  outcome: Outcome | null,
  opts: { note?: string | null; callbackAt?: number | null; user?: string | null; startFollowup?: boolean; now?: number } = {},
): Promise<CallResult> {
  if (outcome === null) {
    // Undo a mis-tapped Wrong number / Number disconnected too: the phone is good again.
    await db.run(
      `UPDATE businesses SET phone_bad = CASE WHEN call_outcome IN (${BAD_PHONE.map(() => "?").join(", ")}) THEN 0 ELSE phone_bad END,
         call_outcome = NULL, callback_at = NULL, warm_tries = 0 WHERE id = ?`,
      ...BAD_PHONE,
      businessId,
    );
    return { followup: null, followupError: null };
  }
  const t = opts.now ?? now();
  const cur = await db.get<{ callback_at: number | null; warm_tries: number; lat: number | null; lng: number | null }>(
    "SELECT callback_at, warm_tries, lat, lng FROM businesses WHERE id = ?",
    businessId,
  );
  const tz = leadTz(cur?.lat ?? null, cur?.lng ?? null);
  let callbackAt: number | null = null;
  let tries = 0;
  if (outcome === "call_back") callbackAt = opts.callbackAt ?? t + 86_400_000;
  else if (outcome === "bad_timing") callbackAt = opts.callbackAt ?? nextTry(t, t, tz);
  else if (cur?.callback_at != null && WARM_RETRY.includes(outcome)) {
    tries = (cur.warm_tries ?? 0) + 1;
    if (tries < WARM_MAX) callbackAt = opts.callbackAt ?? nextTry(cur.callback_at, t, tz);
    else tries = 0; // 6 misses: back to the normal Call again list
  }
  const staysWarm = callbackAt != null;
  await db.batch([
    ["INSERT INTO calls (business_id, outcome, note, user, created_at) VALUES (?, ?, ?, ?, ?)", businessId, outcome, opts.note?.trim() || null, opts.user ?? null, t],
    [
      `UPDATE businesses SET call_outcome = ?, called_at = ?, call_attempts = call_attempts + 1, callback_at = ?, warm_tries = ?,
         dnc = CASE WHEN ? = 'do_not_call' THEN 1 ELSE dnc END, phone_bad = CASE WHEN ? IN ('wrong_number', 'disconnected') THEN 1 ELSE phone_bad END
       WHERE id = ?`,
      outcome,
      t,
      callbackAt,
      tries,
      outcome,
      outcome,
      businessId,
    ],
  ]);

  if (STOPS_EMAIL.includes(outcome)) await stopEmails(businessId);
  if (outcome === "do_not_call") {
    const b = await db.get<{ email: string | null }>("SELECT email FROM businesses WHERE id = ?", businessId);
    if (b?.email) await suppress(b.email, "do_not_call");
  }

  // A warm lead that missed a callback gets another call, not the cold email sequence.
  const wantsFollowup = OUTCOMES.find((o) => o.value === outcome)!.followup && !staysWarm;
  if (!wantsFollowup) return { followup: null, followupError: null };
  const settings = await getSettings();
  if (!settings.emailOutreach) return { followup: null, followupError: null }; // calls only for now
  const auto = opts.startFollowup ?? settings.followupOnNoAnswer;
  if (!auto) return { followup: null, followupError: null };
  const err = await startFollowup(businessId);
  if (err) await logEvent("info", `Lead #${businessId}: no follow-up email (${err})`);
  return { followup: err ? "skipped" : "started", followupError: err };
}

/** "2026-10-16" for a moment in a time zone (falls back to UTC for an unknown zone). */
export function dayKey(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export type CallDay = { date: string; dials: number; answered: number; outcomes: Record<string, number> };

/**
 * Calls per day in the caller's time zone, newest first, for the daily counter: "today 12 calls,
 * 7 no answer, 3 callbacks…". `user` limits it to one person's calls (null = everyone).
 */
export async function dailyCallLog(opts: { tz: string; days?: number; user?: string | null; now?: number }): Promise<{ today: CallDay; days: CallDay[] }> {
  const t = opts.now ?? now();
  const days = Math.min(Math.max(opts.days ?? 14, 1), 90);
  const rows = await db.all<{ outcome: string; created_at: number }>(
    `SELECT outcome, created_at FROM calls WHERE created_at >= ? ${opts.user ? "AND user = ?" : ""} ORDER BY created_at DESC`,
    ...(opts.user ? [t - (days + 1) * 86_400_000, opts.user] : [t - (days + 1) * 86_400_000]),
  );
  const todayKey = dayKey(t, opts.tz);
  const byDay = new Map<string, CallDay>([[todayKey, { date: todayKey, dials: 0, answered: 0, outcomes: {} }]]);
  for (const r of rows) {
    const k = dayKey(r.created_at, opts.tz);
    const d = byDay.get(k) ?? { date: k, dials: 0, answered: 0, outcomes: {} };
    d.dials++;
    if (!NOT_REACHED.includes(r.outcome)) d.answered++;
    d.outcomes[r.outcome] = (d.outcomes[r.outcome] ?? 0) + 1;
    byDay.set(k, d);
  }
  const list = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days);
  return { today: byDay.get(todayKey)!, days: list };
}

export type AgendaItem = {
  id: number;
  name: string;
  phone: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  callback_at: number;
  note: string | null;
  overdue: boolean;
  ask_for: string | null;
  category: string | null;
  category_confirmed: number | null;
  call_outcome: string | null;
  call_attempts: number;
  warm_tries: number;
};

// Warm leads: a callback is set and the phone is still good.
const WARM_WHERE = "b.callback_at IS NOT NULL AND b.dnc = 0 AND b.phone_bad = 0";
const AGENDA_COLS = `b.id, b.name, b.phone, b.city, b.lat, b.lng, b.callback_at, b.ask_for, b.category, b.category_confirmed,
  b.call_outcome, b.call_attempts, b.warm_tries,
  (SELECT c.note FROM calls c WHERE c.business_id = b.id AND c.note IS NOT NULL AND c.note != '' ORDER BY c.created_at DESC LIMIT 1) AS note`;

export type CallbackCounts = { overdue: number; today: number; scheduled: number };

/**
 * Today's to-do: callbacks that are overdue or due today (caller's time zone), earliest first, plus
 * the one set of counts every screen shows: "2 overdue · 3 today · 13 scheduled".
 */
export async function callbackAgenda(tz: string, t = now()): Promise<{ items: AgendaItem[]; tomorrow: number; counts: CallbackCounts }> {
  const rows = await db.all<Omit<AgendaItem, "overdue">>(`SELECT ${AGENDA_COLS} FROM businesses b WHERE ${WARM_WHERE} ORDER BY b.callback_at LIMIT 1000`);
  const today = dayKey(t, tz);
  const tomorrowKey = dayKey(t + 86_400_000, tz);
  const items: AgendaItem[] = [];
  let tomorrow = 0;
  const counts: CallbackCounts = { overdue: 0, today: 0, scheduled: rows.length };
  for (const r of rows) {
    const k = dayKey(r.callback_at, tz);
    if (r.callback_at < t) counts.overdue++;
    else if (k === today) counts.today++;
    if (r.callback_at < t || k <= today) items.push({ ...r, overdue: r.callback_at < t });
    else if (k === tomorrowKey) tomorrow++;
  }
  return { items, tomorrow, counts };
}

export type ScheduledCallback = AgendaItem & {
  day: string;
  marked_at: number | null;
  marked_by: string | null;
};

/**
 * Every callback someone set, earliest first, with the caller's day it falls on ("2026-10-19") and
 * when / by whom it was marked: the follow-up list ("who am I calling on Monday?").
 */
export async function callbackSchedule(tz: string, t = now()): Promise<ScheduledCallback[]> {
  const marked = (col: string) =>
    `(SELECT c.${col} FROM calls c WHERE c.business_id = b.id AND c.outcome IN ('call_back', 'bad_timing') ORDER BY c.created_at DESC LIMIT 1)`;
  const rows = await db.all<Omit<ScheduledCallback, "overdue" | "day">>(
    `SELECT ${AGENDA_COLS}, ${marked("created_at")} AS marked_at, ${marked("user")} AS marked_by
     FROM businesses b WHERE ${WARM_WHERE} ORDER BY b.callback_at LIMIT 500`,
  );
  return rows.map((r) => ({ ...r, day: dayKey(r.callback_at, tz), overdue: r.callback_at < t }));
}
