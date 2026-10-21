import type { Step } from "./campaigns";

// Starter sequences. Short, plain, one clear ask: what gets replies in cold B2B email.

export type Template = { id: string; name: string; description: string; steps: Step[] };

export const TEMPLATES: Template[] = [
  {
    id: "bould_audit",
    name: "Audit finding (Golden Formula)",
    description: "Opens with the #1 issue the lead audit found, then offers the free visibility audit. Run audits first.",
    steps: [
      {
        subject: "{Quick note|Something I noticed} about {{business_name}}",
        body: `{Hi|Hello} {{business_name}} team,

I was searching Google for {{search_term|businesses like yours nearby}} and noticed {{audit_issue|a couple of things on your website that are probably costing you calls}}.

{{personal_line}}

A website should bring you calls every month, not just sit there. We score local businesses on two things: can customers find you, and when they do, do they call? Fixing the weaker side is usually where the quick wins are.

Would a free 20-minute visibility audit for {{business_name}} be useful? You'd see your own score and exactly what's holding it back.`,
        delayDays: 0,
      },
      {
        subject: "",
        body: `{Hi|Hello} again. One concrete example: a concrete company we work with had an old site for 12 months and 0 leads from it. After the rebuild, their first lead came in 2 weeks, and they had 6 leads and $20,000 in work within 3 months.

Happy to run the same free audit for {{business_name}}. Worth 20 minutes?`,
        delayDays: 3,
      },
      {
        subject: "",
        body: `Last note from me. If more calls from Google isn't a priority right now, no problem at all. If it is, reply "audit" and I'll send a couple of times.`,
        delayDays: 5,
      },
    ],
  },
  {
    id: "audit",
    name: "Free website review",
    description: "Offer a short, free review of their site. Works for most local businesses.",
    steps: [
      {
        subject: "{Quick question|Idea} for {{business_name}}",
        body: `{Hi|Hello} {{business_name}} team,

{{personal_line}}

I help local businesses in {{city|your area}} get more customers from their website. I had a look at {{domain|your site}} and spotted a couple of quick wins I think you'd like.

Would it be useful if I sent over a short, free 3-point review?`,
        delayDays: 0,
      },
      {
        subject: "",
        body: `{Hi|Hello} again, just bumping this in case it got buried. Happy to send the free review for {{business_name}} with no strings attached.`,
        delayDays: 3,
      },
    ],
  },
  {
    id: "local_seo",
    name: "Google Maps / local SEO",
    description: "Pitch ranking higher on Google Maps for searches in their city.",
    steps: [
      {
        subject: "{{business_name}} on Google Maps",
        body: `{Hi|Hello} {{business_name}} team,

When people in {{city|your area}} search for a {{category|business like yours}} on Google Maps, the top 3 results get most of the calls and visits.

{{personal_line}}

I help local businesses climb into those top spots. Would you like me to check where {{business_name}} ranks today and what it would take to move up? It's free and takes me 10 minutes.`,
        delayDays: 0,
      },
      {
        subject: "",
        body: `{Hi|Hello}, following up on my note. Want me to send over the free ranking check for {{business_name}}? Just reply "yes".`,
        delayDays: 3,
      },
      {
        subject: "",
        body: `Last note from me. If getting more customers from Google isn't a priority right now, no worries at all. If it is, I'm one reply away.`,
        delayDays: 5,
      },
    ],
  },
  {
    id: "smoke_shop",
    name: "Smoke & vape shops",
    description: "Online store + local search pitch tailored to smoke, vape and CBD shops.",
    steps: [
      {
        subject: "{More walk-ins|More customers} for {{business_name}}",
        body: `{Hi|Hey} {{business_name}} team,

{{personal_line}}

Smoke and vape shops in {{city|your area}} win most of their new customers from two places: Google Maps ("smoke shop near me") and their own website for pickup orders.

I build both for local shops: a clean site with your full catalog and in-store pickup, and a Maps profile that ranks. Within the rules for your products, of course.

Would a quick look at what that could do for {{business_name}} be useful?`,
        delayDays: 0,
      },
      {
        subject: "",
        body: `{Hi|Hey}, just checking this reached you. I can send 2–3 concrete ideas for {{domain|your shop}}, free. Want them?`,
        delayDays: 3,
      },
    ],
  },
  {
    id: "short",
    name: "Short & direct",
    description: "Three sentences. Good for busy owners and trades.",
    steps: [
      {
        subject: "{{business_name}}",
        body: `{Hi|Hello},

I help {{category|local businesses}} in {{city|your area}} get more customers online. I had an idea for {{business_name}}.

Worth a quick chat this week?`,
        delayDays: 0,
      },
      {
        subject: "",
        body: `Just floating this back to the top of your inbox. Any interest?`,
        delayDays: 4,
      },
    ],
  },
  {
    id: "redesign",
    name: "Free homepage mockup",
    description: "Offer a no-obligation redesign concept. Best for businesses with dated sites.",
    steps: [
      {
        subject: "A new look for {{domain|your website}}?",
        body: `{Hi|Hello} {{business_name}} team,

{{personal_line}}

I design websites for local businesses, and I'd like to put together a free homepage mockup for {{business_name}}: a modern, mobile-friendly version of what you have today. No cost and no obligation; if you like it, we can talk.

Should I go ahead?`,
        delayDays: 0,
      },
      {
        subject: "",
        body: `{Hi|Hello} again. Still happy to make that free mockup for {{business_name}}. Just reply "go ahead" and I'll send it within a few days.`,
        delayDays: 4,
      },
    ],
  },
];

/**
 * The no-answer follow-up: sent when a call goes unanswered. Day 1 (right after the call), day 3,
 * day 5 and day 12, then stop. delayDays counts from the previous email. Editable on the Campaigns page.
 */
export const FOLLOWUP_STEPS: Step[] = [
  {
    subject: "{Tried calling|Missed you on the phone} - {{business_name}}",
    body: `{Hi|Hello} {{business_name}} team,

I just tried calling and couldn't reach you, so a quick note instead.

I was looking at {{search_term|local businesses like yours}} on Google and noticed {{audit_issue|a couple of things on your website that are probably costing you calls}}.

We help local businesses turn their website and Google profile into a steady source of calls. Would a free 20-minute visibility audit for {{business_name}} be useful? You'd see your own score and exactly what's holding it back.`,
    delayDays: 0,
  },
  {
    subject: "",
    body: `{Hi|Hello} again. One concrete example: a concrete company we work with had an old site for 12 months and 0 leads from it. After the rebuild, their first lead came in 2 weeks, and they had 6 leads and $20,000 in work within 3 months.

Happy to run the same free audit for {{business_name}}. Is there a good time to call you back?`,
    delayDays: 2,
  },
  {
    subject: "",
    body: `Quick one: if it's easier, just reply with a good time and the best number to reach you, and I'll call then.`,
    delayDays: 2,
  },
  {
    subject: "",
    body: `Last note from me. If more calls from Google isn't a priority right now, no problem at all. If it is, reply "audit" and I'll send a couple of times.`,
    delayDays: 7,
  },
];
