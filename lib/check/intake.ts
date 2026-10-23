import crypto from "node:crypto";
import { db, logEvent, now } from "../db";
import { findPlace, GoogleBudgetError } from "../discovery/google-api";
import { formatPhone } from "../discovery/fit";
import { saveProfile, type AuditRow } from "../audit/run-audit";
import { cityCentre, runTopCheck } from "./run-check";

// Leads that asked for a check: the bouldhq.com request form ("Site request"), Meta Instant Form
// leads (CSV import), and "Call me back" on a results page. They're matched to their Google
// profile, saved (or merged into the lead we already had), and checked straight away so Jake
// opens a lead that's ready to call.

export type IntakeInput = {
  kind: "site" | "meta" | "callback";
  business?: string | null;
  city?: string | null;
  service?: string | null; // "What you do", in their words
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  message?: string | null;
  slug?: string | null; // callback: the results link they were on
  utm?: Record<string, string> | null;
  formSource?: string | null;
  metaId?: string | null; // Meta lead id: importing the same CSV twice doesn't add anyone twice
};

export type IntakeResult = { ok: true; id: number; case: string | null; merged: boolean } | { ok: false; error: string };

const clean = (s: string | null | undefined, max = 200) => (typeof s === "string" ? s.trim().slice(0, max) : "") || null;

export async function intake(input: IntakeInput): Promise<IntakeResult> {
  const name = clean(input.name);
  const phone = clean(input.phone, 40);

  if (input.kind === "callback") {
    const slug = clean(input.slug, 120);
    const row = slug ? await db.get<{ id: number; name: string }>("SELECT id, name FROM businesses WHERE check_slug = ?", slug) : undefined;
    if (!row) return { ok: false, error: "Unknown results link" };
    // Due now in Callbacks: they asked us to call.
    await db.run(
      "UPDATE businesses SET callback_at = ?, ask_for = COALESCE(?, ask_for), phone = COALESCE(phone, ?) WHERE id = ?",
      now(),
      name ? `Ask for ${name}${phone ? ` (${phone})` : ""}` : null,
      phone,
      row.id,
    );
    await logEvent("info", `Call me back from results link: ${row.name}${name ? `, ${name}` : ""}${phone ? ` ${phone}` : ""}`);
    return { ok: true, id: row.id, case: null, merged: true };
  }

  const business = clean(input.business);
  const city = clean(input.city, 100);
  const service = clean(input.service, 100);
  if (!business) return { ok: false, error: "Business name is required" };

  // Their own Google profile, searched near the city they gave.
  let place: Awaited<ReturnType<typeof findPlace>> = null;
  try {
    const centre = city ? await cityCentre(city, "US") : null;
    place = await findPlace([business, city].filter(Boolean).join(" "), centre?.lat, centre?.lng);
  } catch (e) {
    if (!(e instanceof GoogleBudgetError) && !(e instanceof Error && /key is not set/.test(e.message))) throw e;
    await logEvent("warn", `Intake: Google lookup skipped for ${business}: ${(e as Error).message}`);
  }

  const contact = {
    name,
    email: clean(input.email),
    phone,
    service,
    message: clean(input.message, 2000),
    utm: input.utm ?? null,
    form: input.formSource ?? null,
    kind: input.kind,
    metaId: clean(input.metaId, 80),
    at: now(),
  };
  const query = service && city ? `${service} in ${city}` : null;
  const askFor = name ? `Ask for ${name} (asked for a check)` : null;
  const t = now();

  // A business we already have (same Google profile) is updated, not duplicated.
  const existing = place ? await db.get<{ id: number }>("SELECT id FROM businesses WHERE google_place_id = ? OR (source = 'google' AND source_id = ?)", place.id, place.id) : undefined;
  let id: number;
  if (existing) {
    id = existing.id;
    await db.run(
      `UPDATE businesses SET lead_source = ?, lead_contact = ?, phone = COALESCE(?, phone), email = COALESCE(email, ?), ask_for = COALESCE(?, ask_for),
         check_query = COALESCE(?, check_query), callback_at = COALESCE(callback_at, ?), dnc = 0 WHERE id = ?`,
      input.kind,
      JSON.stringify(contact),
      phone,
      contact.email,
      askFor,
      query,
      t,
      id,
    );
  } else {
    id = (
      await db.run(
        `INSERT INTO businesses (source, source_id, name, category, address, city, country_code, lat, lng, phone, website, email, email_source, email_confidence,
           status, created_at, lead_source, lead_contact, ask_for, check_query, callback_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'US', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        place ? "google" : "inbound",
        place ? place.id : `${input.kind}:${crypto.randomUUID()}`,
        place?.displayName?.text ?? business,
        place?.formattedAddress ?? null,
        city,
        place?.location?.latitude ?? null,
        place?.location?.longitude ?? null,
        phone ?? formatPhone(place?.nationalPhoneNumber, "US"),
        place?.websiteUri ?? clean(input.website, 300),
        contact.email,
        contact.email ? "form" : null,
        contact.email ? 100 : null,
        contact.email ? "verified" : "no_email",
        t,
        input.kind,
        JSON.stringify(contact),
        askFor,
        query,
        t, // due now in Callbacks: they asked for the call
      )
    ).lastId;
  }

  if (place) {
    const row = await db.get<AuditRow>("SELECT * FROM businesses WHERE id = ?", id);
    if (row) await saveProfile(row, place);
  }
  await logEvent("info", `${input.kind === "meta" ? "Meta ad" : "Site request"}: ${business}${city ? `, ${city}` : ""}${existing ? " (already a lead: updated)" : ""}`);

  // The check now (one cached search); the full audit (website, deep profile) in the background.
  let kase: string | null = null;
  try {
    kase = (await runTopCheck(id, { force: true }))?.diagnosis.case ?? null;
  } catch (e) {
    await logEvent("warn", `Intake: top-3 check for #${id} will run with the audit: ${e instanceof Error ? e.message : e}`);
  }
  await db.run("UPDATE businesses SET audit_status = 'queued' WHERE id = ? AND COALESCE(audit_status, '') != 'running'", id);
  return { ok: true, id, case: kase, merged: !!existing };
}
