import { Star } from "lucide-react";
import { Badge, cx, type Tone } from "./ui";
import { stageLabel } from "@/lib/call-outcomes";
import { PITCHES, socialLabel } from "@/lib/audit/score";

export const TIER_LABEL: Record<string, string> = { A: "A · call first", B: "B · good lead", C: "C · low priority", not_fit: "Not a fit" };

export function TierBadge({ tier, short }: { tier: string | null; short?: boolean }) {
  if (!tier) return <Badge>unscored</Badge>;
  const tone = tier === "A" ? "green" : tier === "B" ? "blue" : tier === "not_fit" ? "red" : "gray";
  return <Badge tone={tone}>{short ? (tier === "not_fit" ? "Not a fit" : `Tier ${tier}`) : TIER_LABEL[tier]}</Badge>;
}

export function Rating({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating == null && count == null) return null;
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      <Star size={11} className="fill-amber-400 text-amber-400" aria-hidden />
      {rating?.toFixed(1) ?? "–"}
      <span className="text-muted">({count ?? 0})</span>
    </span>
  );
}

/** Compact "V 11/20 · C 45" with a hover explanation. */
export function ScorePair({ v, c, className }: { v: number | null; c: number | null; className?: string }) {
  if (v == null && c == null) return null;
  return (
    <span className={cx("tabular-nums text-xs text-muted", className)} title="Visibility out of 20 (can customers find them?) · Conversion out of 100 (do they call?)">
      V {v ?? "–"}/20 · C {c ?? "–"}
    </span>
  );
}

export { OUTCOMES, STAGES, outcomeLabel, stageLabel } from "@/lib/call-outcomes";

// Callbacks yellow (a time was agreed), Call again orange (try again).
const STAGE_TONE: Record<string, Tone> = {
  new: "gray",
  callback: "yellow",
  replied: "green",
  followup: "blue",
  recall: "orange",
  booked: "green",
  closed: "red",
};

export function StageBadge({ stage }: { stage: string | null | undefined }) {
  if (!stage) return null;
  return <Badge tone={STAGE_TONE[stage] ?? "gray"}>{stageLabel(stage)}</Badge>;
}

/** "Email 2 of 4 · next Thu" for a lead in the no-answer follow-up. */
export function followupText(f: { step: number; steps: number; state: string; nextSendAt: number | null } | null | undefined): string | null {
  if (!f) return null;
  if (f.state === "queued" || f.state === "in_sequence") {
    const next = f.nextSendAt && f.nextSendAt > Date.now() ? ` · next ${new Date(f.nextSendAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : " · sending soon";
    return `Email ${f.step + 1} of ${f.steps}${next}`;
  }
  if (f.state === "completed") return `All ${f.steps} follow-up emails sent`;
  if (f.state === "stopped") return `Follow-up stopped after ${f.step} of ${f.steps}`;
  if (f.state === "replied") return `They replied after email ${f.step}: call them back`;
  if (f.state === "bounced") return "The follow-up email bounced";
  if (f.state === "unsubscribed") return "They asked not to be emailed";
  return `Follow-up: ${f.state.replace(/_/g, " ")}`;
}

/** Big score number with a thin bar, for the lead page. */
export function ScoreMeter({ label, value, max, sub, tone }: { label: string; value: number; max: number; sub?: string; tone: "accent" | "muted" }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tabular-nums">{value}</span>
        <span className="text-sm text-muted">/ {max}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={cx("h-full rounded-full", tone === "accent" ? "bg-accent" : "bg-foreground/60")} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const SITE_TONE: Record<string, Tone> = { none: "gray", social: "blue", directory: "blue", down: "red", parked: "red", blocked: "amber", unlinked: "amber", possible: "gray" };
const SITE_HINT: Record<string, string> = {
  none: "No website of their own",
  social: "Their only web presence is a social or listing page: a different pitch from no website",
  directory: "Their \"website\" is a directory listing, not a site they own",
  down: "Their site didn't load on any address",
  parked: "The domain shows a parked or expired page",
  blocked: "Their site blocked, outlasted or failed our check (common on corporate sites): open it yourself before the call",
  unlinked: "They have a website, but their Google profile doesn't link it: linking it is a quick visibility win",
  possible: "No website on Google, but a site with their name exists: we couldn't confirm it's theirs. Ask on the call",
};

/** One website status everywhere: No site · Facebook only · Domain lapsed · Site down · Parked · Couldn't check. */
export function SiteChip({ state, label, website, socialUrl }: { state?: string | null; label?: string | null; website?: string | null; socialUrl?: string | null }) {
  // Before the audit: we still know whether there's a website at all.
  const key = state ?? (!website ? (socialUrl ? "social" : "none") : null);
  if (!key || !SITE_TONE[key]) return null;
  const text = label ?? (key === "social" ? socialLabel(socialUrl) : "No site");
  return (
    <span title={SITE_HINT[key]}>
      <Badge tone={SITE_TONE[key]}>{text}</Badge>
    </span>
  );
}

const PITCH_TONE: Record<string, Tone> = { website: "blue", visibility: "green", both: "orange", corporate: "gray", solid: "gray" };
const PITCH_HINT: Record<string, string> = {
  website: "Pitch: a website. No site, a dead one, or one that loses customers; visibility is fine",
  visibility: "Pitch: visibility. Their site is fine; the Google profile, reviews or map ranking are weak",
  both: "Pitch: website + visibility. Weak on both sides: the bundle",
  corporate: "Chain or franchise: the store can't buy. Kept out of the top of the call list",
  solid: "Both sides look fine: a light-touch pitch (monthly program, specific fixes)",
};

/** What to sell this lead, from the audit. */
export function PitchBadge({ pitch }: { pitch: string | null | undefined }) {
  if (!pitch || !PITCHES[pitch as keyof typeof PITCHES]) return null;
  return (
    <span title={PITCH_HINT[pitch]}>
      <Badge tone={PITCH_TONE[pitch]}>{PITCHES[pitch as keyof typeof PITCHES]}</Badge>
    </span>
  );
}
