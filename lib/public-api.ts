import crypto from "node:crypto";

// The small public API bouldhq.com calls (intake, results links). Every route checks
// "Authorization: Bearer <SITE_API_SECRET>"; proxy.ts lets /api/public/ through without a login.

export function publicAuthorized(req: Request): boolean {
  const secret = process.env.SITE_API_SECRET;
  if (!secret) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const unauthorized = () => Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

/** Where results links live (bouldhq.com/check/<slug>). */
export const SITE_URL = () => (process.env.BOULD_SITE_URL || "https://bouldhq.com").replace(/\/$/, "");
