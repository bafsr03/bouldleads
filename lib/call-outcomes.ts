// Call dispositions and lead stages, shared by the server (lib/calls.ts) and the UI.

export const OUTCOMES = [
  { value: "no_answer", label: "No answer", followup: true, tone: "gray" },
  { value: "voicemail", label: "Voicemail", followup: true, tone: "gray" },
  { value: "call_back", label: "Call back", followup: false, tone: "yellow" },
  { value: "audit_booked", label: "Audit booked", followup: false, tone: "green" },
  { value: "won", label: "Won: client", followup: false, tone: "green" },
  { value: "bad_timing", label: "Bad timing", followup: false, tone: "amber" }, // reached them, they couldn't talk: try again
  { value: "hung_up", label: "Hung up", followup: false, tone: "orange" },
  { value: "not_interested", label: "Not interested", followup: false, tone: "red" },
  { value: "wrong_number", label: "Wrong number", followup: false, tone: "red" },
  { value: "disconnected", label: "Number disconnected", followup: false, tone: "red" },
  { value: "do_not_call", label: "Do not call", followup: false, tone: "red" },
] as const;

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
export const WARM_RETRY: string[] = ["no_answer", "voicemail", "hung_up"];
/** Outcomes that close a lead: the call buttons ask for a second tap. */
export const CLOSING: string[] = ["not_interested", "do_not_call", "wrong_number", "disconnected"];
