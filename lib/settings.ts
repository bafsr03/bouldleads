import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

export type Settings = {
  companyName: string;
  postalAddress: string; // required by CAN-SPAM; shown in every email footer
  optOutLine: string;
  timezone: string; // IANA zone for the send window and daily caps, e.g. America/Lima
  sendWindowStart: number; // hour 0-23 in `timezone`
  sendWindowEnd: number;
  sendDays: number[]; // 0=Sun … 6=Sat
  minGapSeconds: number;
  maxGapSeconds: number;
  warmupStartPerDay: number;
  warmupIncrementPerDay: number;
  aiProvider: "none" | "ollama" | "anthropic";
  ollamaUrl: string;
  ollamaModel: string;
  anthropicModel: string;
  allowConsentCountries: boolean; // DE/AT etc. — off by default
  googleFreeTierOnly: boolean; // stop Google calls when the free monthly allowance is used
  autoAudit: boolean; // audit every new lead automatically
  auditPageSpeed: boolean; // add a Google PageSpeed (mobile) score to audits; slow
  emailOutreach: boolean; // master switch: off = calls, leads and map only; nothing is ever emailed
  followupOnNoAnswer: boolean; // "No answer" / "Voicemail" starts the email follow-up automatically
  personalTiers: string[]; // tiers worked from personal phones; the rest is the dialer list
  dialerBatchSize: number; // leads per dialer export
};

export const DEFAULT_SETTINGS: Settings = {
  companyName: "",
  postalAddress: "",
  optOutLine: "Not interested? Just reply \"remove\" and you won't hear from me again.",
  timezone: "America/New_York",
  sendWindowStart: 9,
  sendWindowEnd: 17,
  sendDays: [1, 2, 3, 4, 5],
  minGapSeconds: 90,
  maxGapSeconds: 240,
  warmupStartPerDay: 10,
  warmupIncrementPerDay: 5,
  aiProvider: "none",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  anthropicModel: "claude-haiku-4-5",
  allowConsentCountries: false,
  googleFreeTierOnly: true,
  autoAudit: true,
  auditPageSpeed: false,
  emailOutreach: false,
  followupOnNoAnswer: true,
  personalTiers: ["A"],
  dialerBatchSize: 200,
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.all<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key NOT LIKE 'secret:%' AND key NOT LIKE 'sys:%'",
  );
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = JSON.parse(r.value);
  }
  return out as Settings;
}

const UPSERT = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

export async function saveSettings(patch: Partial<Settings>) {
  const stmts = Object.entries(patch)
    .filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined)
    .map(([k, v]) => [UPSERT, k, JSON.stringify(v)] as [string, string, string]);
  if (stmts.length) await db.batch(stmts);
}

// Secrets (API keys) are stored encrypted and never returned to the browser.
export type SecretName = "anthropicApiKey" | "googlePlacesApiKey";

export const secretFromEnv = (name: SecretName) => process.env[name === "anthropicApiKey" ? "ANTHROPIC_API_KEY" : "GOOGLE_PLACES_API_KEY"];

export async function getSecret(name: SecretName): Promise<string | undefined> {
  const env = secretFromEnv(name);
  if (env) return env;
  const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `secret:${name}`);
  return row ? decrypt(row.value) : undefined;
}

export async function setSecret(name: SecretName, value: string | null) {
  if (!value) await db.run("DELETE FROM settings WHERE key = ?", `secret:${name}`);
  else await db.run(UPSERT, `secret:${name}`, encrypt(value));
}

// System values (background-task heartbeat, Google usage counters, locks…)
export async function getSys(key: string): Promise<string | undefined> {
  return (await db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `sys:${key}`))?.value;
}

export async function setSys(key: string, value: string) {
  await db.run(UPSERT, `sys:${key}`, value);
}
