import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { decrypt } from "../crypto";
import { db } from "../db";

export type InboxRow = {
  id: number;
  label: string;
  from_name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: number | null;
  username: string;
  password_enc: string;
  daily_cap: number;
  warmup_enabled: number;
  warmup_start: number;
  sent_date: string | null;
  sent_today: number;
  next_send_at: number;
  imap_last_uid: number;
  imap_uid_validity: string | null;
  last_error: string | null;
  active: number;
  created_at: number;
};

export type InboxConn = {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean | null;
  username: string;
  password: string;
};

export const PRESETS: Record<string, Omit<InboxConn, "email" | "username" | "password">> = {
  google: { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true },
  zoho: { smtpHost: "smtppro.zoho.com", smtpPort: 465, smtpSecure: true, imapHost: "imappro.zoho.com", imapPort: 993, imapSecure: true },
  zoho_eu: { smtpHost: "smtppro.zoho.eu", smtpPort: 465, smtpSecure: true, imapHost: "imappro.zoho.eu", imapPort: 993, imapSecure: true },
  outlook: { smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false, imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true },
  mailpit: { smtpHost: "localhost", smtpPort: 1025, smtpSecure: false, imapHost: null, imapPort: null, imapSecure: null },
};

export function connFromRow(r: InboxRow): InboxConn {
  return {
    email: r.email,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpSecure: !!r.smtp_secure,
    imapHost: r.imap_host,
    imapPort: r.imap_port,
    imapSecure: r.imap_secure === null ? null : !!r.imap_secure,
    username: r.username,
    password: decrypt(r.password_enc),
  };
}

export function getInbox(id: number): Promise<InboxRow | undefined> {
  return db.get<InboxRow>("SELECT * FROM inboxes WHERE id = ?", id);
}

const isLocal = (h: string) => h === "localhost" || h === "127.0.0.1";

export function smtpTransport(c: InboxConn) {
  return nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecure,
    requireTLS: !c.smtpSecure && !isLocal(c.smtpHost),
    auth: isLocal(c.smtpHost) && !c.password ? undefined : { user: c.username, pass: c.password },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
}

export function imapClient(c: InboxConn) {
  if (!c.imapHost || !c.imapPort) return null;
  return new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapSecure ?? true,
    auth: { user: c.username, pass: c.password },
    logger: false,
  });
}

export async function testConnection(c: InboxConn): Promise<{ smtp: string; imap: string }> {
  let smtp = "ok";
  let imap = "not configured";
  try {
    await smtpTransport(c).verify();
  } catch (e) {
    smtp = e instanceof Error ? e.message : String(e);
  }
  const client = imapClient(c);
  if (client) {
    try {
      await client.connect();
      await client.logout();
      imap = "ok";
    } catch (e) {
      imap = e instanceof Error ? e.message : String(e);
    }
  }
  return { smtp, imap };
}

/** Daily allowance: ramps from warmupStart by +increment per day until the inbox's cap. */
export function allowedToday(
  inbox: Pick<InboxRow, "daily_cap" | "warmup_enabled" | "warmup_start">,
  warmupStartPerDay: number,
  warmupIncrementPerDay: number,
  at = Date.now(),
): number {
  if (!inbox.warmup_enabled) return inbox.daily_cap;
  const days = Math.max(0, Math.floor((at - inbox.warmup_start) / 86_400_000));
  return Math.min(inbox.daily_cap, warmupStartPerDay + days * warmupIncrementPerDay);
}

/** Wall-clock parts of `d` in an IANA time zone (the server itself runs in UTC on Vercel). */
export function zoned(d: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" }).formatToParts(d);
  } catch {
    return zoned(d, "UTC"); // unknown zone name
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), day: days.indexOf(get("weekday")) };
}

/** YYYY-MM-DD in the sending time zone, for the per-day send counter. */
export const localDate = (timeZone: string, d = new Date()) => zoned(d, timeZone).date;
