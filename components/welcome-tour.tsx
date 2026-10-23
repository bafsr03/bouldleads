"use client";

import { ArrowLeft, ArrowRight, Map, Mail, MousePointerClick, PhoneCall, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, cx } from "./ui";
import { send } from "./use-api";

// First-sign-in walkthrough of the call-first workflow. Opens automatically once per person and
// again from "Guide" in the sidebar (openWelcomeTour()).

const STEPS = [
  {
    icon: Sparkles,
    title: (name: string | null) => `Welcome${name ? `, ${name}` : ""}`,
    body: "BouldLeads finds local businesses, audits how visible they are on Google and how well their website brings in calls, and ranks them so you call the best ones first. You make the calls; reminders and tracking run by themselves.",
    href: null,
    cta: null,
  },
  {
    icon: PhoneCall,
    title: () => "Start every day on the Call list",
    body: "Work the tabs in this order: Callbacks (they asked you to call back; an amber badge means it's due), then To call (new leads, best first), then Call again. Each card shows their local time and the one problem to open with.",
    href: "/calls",
    cta: "Open the call list",
  },
  {
    icon: MousePointerClick,
    title: () => "One tap after every call",
    body: "No answer or Voicemail: the app emails them on day 1, 3, 5 and 12 and stops if they reply. Call back: pick a time and they come back under Callbacks. Booked, Not interested, Wrong number and Do not call stop the emails. Made a mistake? More → Clear status.",
    bodyCallsOnly:
      "No answer or Voicemail: the lead moves to Call again so you can try later. Call back: pick a time and they come back under Callbacks. Booked moves them to Booked & won; Not interested, Wrong number and Do not call take them off the list. Made a mistake? More → Clear status.",
    href: null,
    cta: null,
  },
  {
    icon: Mail,
    title: () => "The call brief",
    body: "Open any lead (Full audit & call brief) before you dial: scores, talking points, the top-3 check (where they rank, the top 3, the one thing to say), a checklist you can answer live with Yes / No, notes, and every call and email so far. Your notes and results are saved with your name and show up for the whole team instantly.",
    href: null,
    cta: null,
  },
  {
    icon: Map,
    title: () => "See it all on the map",
    body: "Places is the live dashboard: countries, states and cities shaded by leads, hot spots where they cluster, and today's calls, answer rate and bookings. Switch the map to Called or Booked to see results. It updates by itself as you work.",
    href: "/places",
    cta: "Open the map",
  },
];

const bus = typeof window !== "undefined" ? new EventTarget() : null;

/** Re-open the tour (the sidebar's Guide link). */
export function openWelcomeTour() {
  bus?.dispatchEvent(new Event("open"));
}

export function WelcomeTour({ user, autoOpen, emailOn }: { user: string | null; autoOpen: boolean; emailOn: boolean }) {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const opened = useRef(false);

  const open = () => {
    setStep(0);
    if (ref.current && !ref.current.open) ref.current.showModal();
  };

  useEffect(() => {
    if (autoOpen && !opened.current) {
      opened.current = true;
      open();
    }
  }, [autoOpen]);

  useEffect(() => {
    if (!bus) return;
    bus.addEventListener("open", open);
    return () => bus.removeEventListener("open", open);
  }, []);

  const close = () => {
    ref.current?.close();
    send("/api/auth/me", "POST").catch(() => {});
  };

  const s = STEPS[step];
  const Icon = s.icon;
  const last = step === STEPS.length - 1;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/50"
      aria-label="Welcome tour"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon size={22} />
          </span>
          <button onClick={close} className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground" aria-label="Close the tour">
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
          Step {step + 1} of {STEPS.length}
        </div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{s.title(user)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{!emailOn && "bodyCallsOnly" in s ? s.bodyCallsOnly : s.body}</p>
        {s.href && (
          <Link href={s.href} onClick={close} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            {s.cta} <ArrowRight size={13} />
          </Link>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} className={cx("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-accent" : "w-1.5 bg-border")} />
          ))}
        </div>
        <div className="flex gap-2">
          {step > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={13} /> Back
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={close}>
              Skip
            </Button>
          )}
          {last ? (
            <Link href="/calls" onClick={close}>
              <Button size="sm" variant="primary">
                Start calling
              </Button>
            </Link>
          ) : (
            <Button size="sm" variant="primary" onClick={() => setStep(step + 1)}>
              Next <ArrowRight size={13} />
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
