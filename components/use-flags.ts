"use client";

import { useSyncExternalStore } from "react";

// App-wide feature flags read once per page load (from /api/stats) and shared by every component,
// so a list of 100 call cards doesn't fetch them 100 times. refreshFlags() after Settings are saved.

let emailOn: boolean | null = null;
let loading = false;
const subs = new Set<() => void>();

function load() {
  if (loading || typeof window === "undefined") return;
  loading = true;
  fetch("/api/stats", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { emailOutreach?: boolean } | null) => {
      if (j) emailOn = !!j.emailOutreach;
      subs.forEach((f) => f());
    })
    .catch(() => {})
    .finally(() => (loading = false));
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  if (emailOn === null) load();
  return () => subs.delete(cb);
};

/** Email outreach switch (Settings). null while loading. */
export const useEmailOn = () =>
  useSyncExternalStore(
    subscribe,
    () => emailOn,
    () => null,
  );

export function refreshFlags() {
  emailOn = null;
  load();
}
