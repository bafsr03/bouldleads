import { db } from "@/lib/db";
import { bad, body, json } from "@/lib/api";
import { leadQuery, renderStep, type BusinessRow, type LeadFilter, type Step } from "@/lib/outreach/campaigns";
import { personalLine } from "@/lib/outreach/personalize";
import { ruleFor } from "@/lib/compliance/rules";

// Render every step for a sample lead matching the filter (or a specific business).
export async function POST(req: Request) {
  const b = await body<{ steps: Step[]; filter?: LeadFilter; businessId?: number; senderName?: string; offset?: number; ai?: boolean; followup?: boolean }>(req);
  if (!Array.isArray(b.steps) || b.steps.length === 0) return bad("No steps");
  let lead: BusinessRow | undefined;
  if (b.businessId) lead = await db.get<BusinessRow>("SELECT * FROM businesses WHERE id = ?", b.businessId);
  else if (b.followup) {
    // The no-answer follow-up goes to called leads: preview with the best one that has an email.
    lead = await db.get<BusinessRow>(
      `SELECT * FROM businesses WHERE email IS NOT NULL AND status = 'verified'
       ORDER BY call_outcome IN ('no_answer','voicemail') DESC, COALESCE(priority,-1) DESC, id LIMIT 1 OFFSET ?`,
      Math.max(0, b.offset ?? 0),
    );
  } else {
    const { where, params } = await leadQuery(b.filter ?? {});
    lead = await db.get<BusinessRow>(
      `SELECT * FROM businesses b WHERE ${where} ORDER BY COALESCE(b.priority,-1) DESC, COALESCE(b.email_confidence,0) DESC, b.id LIMIT 1 OFFSET ?`,
      ...params,
      Math.max(0, b.offset ?? 0),
    );
  }
  lead ??= {
    id: 0,
    name: "Sunrise Bakery",
    category: "bakery",
    city: "Austin",
    country_code: "US",
    website: "https://sunrisebakery.example",
    domain: "sunrisebakery.example",
    email: "hello@sunrisebakery.example",
    site_summary: "Family-run sourdough bakery since 1998, open daily from 7am.",
  };

  let line: string | null = null;
  let aiError: string | null = null;
  if (b.ai && b.steps.some((s) => s.body.includes("personal_line"))) {
    try {
      line = await personalLine({ name: lead.name, category: lead.category, city: lead.city, siteSummary: lead.site_summary });
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    }
  }
  const sender = b.senderName?.trim() || "Alex";
  let threadSubject: string | null = null;
  const emails = [];
  for (const [i, step] of b.steps.entries()) {
    const r = await renderStep(step, i, lead!, sender, line, threadSubject);
    if (i === 0) threadSubject = r.subject;
    emails.push(r);
  }
  return json({ lead: { id: lead.id, name: lead.name, email: lead.email, city: lead.city }, rule: ruleFor(lead.country_code), emails, aiError });
}
