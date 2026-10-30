// Short-lived in-memory cache for the heavy count / report queries the pages poll. Turso bills every row
// read, and these scan the whole leads table: with several tabs open they ran hundreds of times an hour.
// Per server instance; concurrent callers share one query. A failed query isn't kept.

const store = new Map<string, { until: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
  if (store.size > 200) for (const [k, v] of store) if (v.until <= Date.now()) store.delete(k); // map views: one key per area
  const value = fn();
  store.set(key, { until: Date.now() + ttlMs, value });
  value.catch(() => store.delete(key));
  return value;
}

/** Drop cached results whose key starts with `prefix`, after a change the user expects to see at once. */
export function forget(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
