import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, isHosted } from "./db";

// AES-256-GCM for SMTP/IMAP passwords and API keys at rest.
// The key lives in data/secret.key (created on first use) unless BOULDLEADS_SECRET is set.

let cachedKey: Buffer | undefined;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.BOULDLEADS_SECRET;
  if (fromEnv) {
    cachedKey = crypto.createHash("sha256").update(fromEnv).digest();
    return cachedKey;
  }
  // Hosted deployments have no persistent disk: the key must come from the environment.
  if (isHosted()) throw new Error("Set BOULDLEADS_SECRET in the deployment's environment variables.");
  const file = path.join(DATA_DIR, "secret.key");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
