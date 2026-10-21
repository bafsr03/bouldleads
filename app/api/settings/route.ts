import { connection } from "next/server";
import { body, json } from "@/lib/api";
import { getSecret, getSettings, saveSettings, secretFromEnv, setSecret, type Settings } from "@/lib/settings";
import { FREE_PER_MONTH, SKU_LABEL, googleUsage, type Sku } from "@/lib/discovery/google-api";

export async function GET() {
  await connection();
  return json({
    settings: await getSettings(),
    secrets: { anthropicApiKey: !!(await getSecret("anthropicApiKey")), googlePlacesApiKey: !!(await getSecret("googlePlacesApiKey")) },
    // Keys set as environment variables (hosted) can't be changed from the app.
    secretsFromEnv: { anthropicApiKey: !!secretFromEnv("anthropicApiKey"), googlePlacesApiKey: !!secretFromEnv("googlePlacesApiKey") },
    googleUsage: Object.entries(await googleUsage()).map(([sku, used]) => ({
      sku,
      label: SKU_LABEL[sku as Sku],
      used,
      free: Number.isFinite(FREE_PER_MONTH[sku as Sku]) ? FREE_PER_MONTH[sku as Sku] : null,
    })),
  });
}

export async function PUT(req: Request) {
  const b = await body<{ settings?: Partial<Settings>; secrets?: { anthropicApiKey?: string | null; googlePlacesApiKey?: string | null } }>(req);
  if (b.settings) await saveSettings(b.settings);
  if (b.secrets) {
    // undefined = unchanged, "" or null = remove
    if (b.secrets.anthropicApiKey !== undefined) await setSecret("anthropicApiKey", b.secrets.anthropicApiKey || null);
    if (b.secrets.googlePlacesApiKey !== undefined) await setSecret("googlePlacesApiKey", b.secrets.googlePlacesApiKey || null);
  }
  return json({ ok: true });
}
