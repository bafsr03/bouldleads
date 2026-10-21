import dns from "node:dns/promises";

// Free, non-intrusive email validation: syntax + domain accepts mail (MX or A).
// We deliberately don't do SMTP RCPT probing — it gets your IP blocklisted.

const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "sharklasers.com",
  "dispostable.com",
  "maildrop.cc",
]);

const mxCache = new Map<string, Promise<boolean>>();

async function domainAcceptsMail(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    // "Null MX" (RFC 7505) means the domain explicitly accepts no mail.
    if (mx.length === 1 && (mx[0].exchange === "" || mx[0].exchange === ".")) return false;
    if (mx.length > 0) return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENODATA" && code !== "ENOTFOUND") throw e; // transient DNS issue: let caller retry
    if (code === "ENOTFOUND") return false;
  }
  try {
    return (await dns.resolve4(domain)).length > 0;
  } catch {
    return false;
  }
}

export type VerifyResult = { ok: boolean; reason?: string };

export async function verifyEmail(email: string): Promise<VerifyResult> {
  const m = /^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email);
  if (!m) return { ok: false, reason: "syntax" };
  const domain = m[1].toLowerCase();
  if (DISPOSABLE.has(domain)) return { ok: false, reason: "disposable" };
  if (!mxCache.has(domain)) mxCache.set(domain, domainAcceptsMail(domain));
  try {
    return (await mxCache.get(domain)) ? { ok: true } : { ok: false, reason: "no-mx" };
  } catch (e) {
    mxCache.delete(domain);
    throw e;
  }
}
