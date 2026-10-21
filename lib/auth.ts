import crypto from "node:crypto";
import { cookies } from "next/headers";

// Simple shared login for the team (Brian, Jake…). Users come from the APP_USERS environment variable:
//   APP_USERS="Brian:scrypt.<salt>.<hash>,Jake:scrypt.<salt>.<hash>"   (make hashes with `npm run hash-password`)
// Sessions are HMAC-signed cookies (SESSION_SECRET). With no APP_USERS set (local use), login is off.

export const SESSION_COOKIE = "bl_session";
const SESSION_DAYS = 30;

export const authEnabled = () => !!process.env.APP_USERS?.trim();

function users(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (process.env.APP_USERS ?? "").split(",")) {
    const i = entry.indexOf(":");
    if (i > 0) out.set(entry.slice(0, i).trim(), entry.slice(i + 1).trim());
  }
  return out;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  // "." separators: "$" would be expanded as a variable inside .env files.
  return `scrypt.${salt.toString("base64")}.${crypto.scryptSync(password, salt, 32).toString("base64")}`;
}

function checkHash(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(/[.$]/);
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(password, Buffer.from(salt, "base64"), want.length);
  return want.length > 0 && crypto.timingSafeEqual(want, got);
}

/** The user's canonical name if the login is right. Names are case-insensitive. */
export function checkLogin(name: string, password: string): string | null {
  for (const [user, hash] of users()) if (user.toLowerCase() === name.trim().toLowerCase() && checkHash(password, hash)) return user;
  return null;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("Set SESSION_SECRET (at least 16 characters) to enable logins.");
  return s;
}

const sign = (data: string) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function makeSession(user: string): { value: string; maxAge: number } {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const data = `${Buffer.from(user).toString("base64url")}.${exp}`;
  return { value: `${data}.${sign(data)}`, maxAge: SESSION_DAYS * 86_400 };
}

/** User name from a session cookie value, or null if missing, forged or expired (or the user was removed). */
export function readSession(value: string | undefined): string | null {
  if (!value) return null;
  const [u, exp, sig] = value.split(".");
  if (!u || !exp || !sig) return null;
  const want = sign(`${u}.${exp}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now()) return null;
  const user = Buffer.from(u, "base64url").toString("utf8");
  return users().has(user) ? user : null;
}

/** Signed-in user for the current request (null when logins are off). */
export async function currentUser(): Promise<string | null> {
  if (!authEnabled()) return null;
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}
