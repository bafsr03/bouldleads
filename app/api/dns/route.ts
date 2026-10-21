import dns from "node:dns/promises";
import { bad, json } from "@/lib/api";

// Checks the sending domain's authentication records (SPF, DKIM, DMARC, MX).
const DKIM_SELECTORS = ["google", "zmail", "zoho", "selector1", "selector2", "default", "dkim", "mail", "k1", "s1", "s2", "smtp", "mxvault"];

async function txt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((r) => r.join(""));
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get("domain")?.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return bad("Invalid domain");

  const [root, dmarc, mx] = await Promise.all([
    txt(domain),
    txt(`_dmarc.${domain}`),
    dns.resolveMx(domain).catch(() => []),
  ]);
  const spf = root.find((r) => r.startsWith("v=spf1")) ?? null;
  const dmarcRec = dmarc.find((r) => r.startsWith("v=DMARC1")) ?? null;
  const dkim: { selector: string; record: string }[] = [];
  await Promise.all(
    DKIM_SELECTORS.map(async (sel) => {
      const rec = (await txt(`${sel}._domainkey.${domain}`)).find((r) => /v=DKIM1|k=rsa|p=/.test(r));
      if (rec) dkim.push({ selector: sel, record: rec.slice(0, 80) + "…" });
    }),
  );

  return json({
    domain,
    mx: mx.map((m) => m.exchange),
    spf,
    dmarc: dmarcRec,
    dkim,
    ok: !!spf && !!dmarcRec && dkim.length > 0 && mx.length > 0,
  });
}
