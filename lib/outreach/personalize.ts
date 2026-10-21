import Anthropic from "@anthropic-ai/sdk";
import { getSecret, getSettings } from "../settings";

// Optional: one personalised opening sentence per lead, from the business's own website summary.
// Providers: local Ollama (free) or Claude via the Anthropic API.

export type LeadContext = {
  name: string;
  category: string | null;
  city: string | null;
  siteSummary: string | null;
};

const SYSTEM = `You write the first sentence of a short, friendly B2B cold email.
Write ONE sentence (max 25 words) that shows you looked at the business: mention something specific from their website summary.
No greetings, no flattery clichés, no exclamation marks, no emojis, no claims you can't verify. Output only the sentence.`;

function prompt(c: LeadContext) {
  return `Business: ${c.name}\nType: ${c.category ?? "unknown"}\nCity: ${c.city ?? "unknown"}\nWebsite summary: ${
    c.siteSummary?.slice(0, 800) ?? "none"
  }`;
}

function clean(s: string): string | null {
  const line = s.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].trim();
  return line.length > 10 && line.length < 300 ? line : null;
}

let anthropic: Anthropic | undefined;

export async function personalLine(c: LeadContext): Promise<string | null> {
  const s = await getSettings();
  if (s.aiProvider === "none" || !c.siteSummary) return null;

  if (s.aiProvider === "ollama") {
    const res = await fetch(`${s.ollamaUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: s.ollamaModel, system: SYSTEM, prompt: prompt(c), stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    return clean(((await res.json()) as { response: string }).response);
  }

  const apiKey = await getSecret("anthropicApiKey");
  if (!apiKey) throw new Error("Anthropic API key missing (Settings → API keys)");
  anthropic ??= new Anthropic({ apiKey });
  const msg = await anthropic.messages.create({
    model: s.anthropicModel,
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt(c) }],
  });
  if (msg.stop_reason === "refusal") return null;
  const text = msg.content.find((b) => b.type === "text");
  return text && text.type === "text" ? clean(text.text) : null;
}
