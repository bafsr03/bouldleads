import type { TopCheck } from "./run-check";

/** The few fields of a saved check a list row needs (the full check stays on the lead page). */
export function checkSummary(raw: string | null) {
  if (!raw) return { check_rank: null, check_query: null, check_say: null, check_gap: null };
  try {
    const c = JSON.parse(raw) as TopCheck;
    return { check_rank: c.rank, check_query: c.query, check_say: c.diagnosis.say, check_gap: c.diagnosis.gap };
  } catch {
    return { check_rank: null, check_query: null, check_say: null, check_gap: null };
  }
}
