// Call dispositions and lead stages, shared by the server (lib/calls.ts) and the UI.

// Labels follow the call tracking in the Oct 28 2026 brief (§7): No answer · Voicemail · Gatekeeper ·
// Talked: not interested · Talked: callback · Screen share booked · Closed · Bad lead (with reason).
// Values stay the same so older calls keep their meaning.
export const OUTCOMES = [
  { value: "no_answer", label: "No answer", followup: true, tone: "gray" },
  { value: "voicemail", label: "Voicemail", followup: true, tone: "gray" },
  { value: "gatekeeper", label: "Gatekeeper", followup: false, tone: "orange" }, // reached someone, not the owner: call again
  { value: "call_back", label: "Talked: callback", followup: false, tone: "yellow" },
  { value: "audit_booked", label: "Screen share booked", followup: false, tone: "green" },
  { value: "won", label: "Closed: client", followup: false, tone: "green" },
  { value: "bad_timing", label: "Bad timing", followup: false, tone: "amber" }, // reached them, they couldn't talk: try again
  { value: "hung_up", label: "Hung up", followup: false, tone: "orange" },
  { value: "not_interested", label: "Talked: not interested", followup: false, tone: "red" },
  { value: "bad_lead", label: "Bad lead", followup: false, tone: "red" }, // with a reason (BAD_REASONS)
  { value: "wrong_number", label: "Wrong number", followup: false, tone: "red" },
  { value: "disconnected", label: "Number disconnected", followup: false, tone: "red" },
  { value: "do_not_call", label: "Do not call", followup: false, tone: "red" },
] as const;

/** Why a lead was bad: each one feeds back into the filters (lib/calls.ts) and the bad-lead rate. */
export const BAD_REASONS = [
  { value: "not_customer", label: "Not a customer", hint: "Adds their Google category to Settings → Excluded categories" },
  { value: "already_top3", label: "Already top 3" },
  { value: "wrong_trade", label: "Wrong trade" },
  { value: "out_of_business", label: "Out of business" },
  { value: "wrong_number", label: "Wrong number", hint: "Marks the phone bad" },
] as const;
export type BadReason = (typeof BAD_REASONS)[number]["value"];
export const isBadReason = (v: unknown): v is BadReason => BAD_REASONS.some((r) => r.value === v);
export const badReasonLabel = (v: string | null | undefined) => BAD_REASONS.find((r) => r.value === v)?.label ?? v ?? "";

/** A real conversation with the owner: counted as "conversations" in the weekly numbers. */
export const CONVERSATION: string[] = ["call_back", "audit_booked", "won", "not_interested", "bad_timing"];

export type Outcome = (typeof OUTCOMES)[number]["value"];

/** Dials that didn't reach anyone: not counted as "answered" in the counter and reports. */
export const NOT_REACHED: string[] = ["no_answer", "voicemail", "wrong_number", "disconnected"];
/** Outcomes that mean the phone number itself is no good (the lead leaves the call list). */
export const BAD_PHONE: string[] = ["wrong_number", "disconnected"];
export const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some((o) => o.value === v);
export const outcomeLabel = (v: string | null | undefined) => (v ? (OUTCOMES.find((o) => o.value === v)?.label ?? v) : "Not called yet");

export const STAGES = [
  { value: "new", label: "To call", hint: "Never called. Best leads first." },
  { value: "callback", label: "Callbacks", hint: "Warm: they asked you to call back, or it was bad timing." },
  { value: "replied", label: "Replied", hint: "Answered an email: call them now." },
  { value: "followup", label: "Emailing", hint: "Didn't pick up; in the email follow-up." },
  { value: "recall", label: "Call again", hint: "Called before, no emails running. Try again." },
  { value: "booked", label: "Booked & won", hint: "Audit booked or became a client." },
  { value: "closed", label: "Closed", hint: "Not interested or do not call." },
] as const;

export type Stage = (typeof STAGES)[number]["value"];
export const stageLabel = (v: string | null | undefined) => STAGES.find((s) => s.value === v)?.label ?? v ?? "";

/** Misses (no answer, voicemail, hung up) a warm lead gets before it goes back to Call again. */
export const WARM_MAX = 6;
/** Outcomes that keep a warm lead warm: try again at the same time on the next business day. */
export const WARM_RETRY: string[] = ["no_answer", "voicemail", "hung_up", "gatekeeper"];
/** Outcomes that close a lead: the call buttons ask for a second tap. */
export const CLOSING: string[] = ["not_interested", "do_not_call", "wrong_number", "disconnected", "bad_lead"];
