// Shared HTTP helpers. Public OSM services require an identifying User-Agent.
export const USER_AGENT =
  process.env.BOULDLEADS_USER_AGENT ?? "BouldLeads/1.0 (local lead research tool; contact: admin@localhost)";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init;
  return fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": USER_AGENT, ...(rest.headers ?? {}) },
  });
}
