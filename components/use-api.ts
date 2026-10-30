"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Session expired: back to the login page, returning here afterwards. */
function toLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

/** Fetch JSON from our API, optionally polling. */
export function useApi<T>(url: string | null, pollMs?: number) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const reload = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (res.status === 401) return toLogin();
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      if (u === urlRef.current) {
        setData(j as T);
        setError(undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Polling pauses while the tab is hidden (every request reads the database, which is billed per row)
  // and catches up as soon as it's shown again.
  useEffect(() => {
    reload();
    if (!pollMs) return;
    let last = Date.now();
    const tick = () => {
      if (document.hidden) return;
      last = Date.now();
      reload();
    };
    const t = setInterval(tick, pollMs);
    const onShow = () => {
      if (!document.hidden && Date.now() - last > pollMs) tick();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [url, pollMs, reload]);

  return { data, error, reload };
}

export async function send<T = unknown>(url: string, method: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (res.status === 401) toLogin();
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
  return j as T;
}
