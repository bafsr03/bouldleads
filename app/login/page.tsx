"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Input, Label, Notice } from "@/components/ui";

function LoginForm() {
  const next = useSearchParams().get("next");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, password }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(j.error ?? "Couldn't sign in.");
      setBusy(false);
      return;
    }
    // Only same-site paths.
    window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <Label>Name</Label>
        <Input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jake" required />
      </label>
      <label className="block">
        <Label>Password</Label>
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <Notice tone="red">{error}</Notice>}
      <Button variant="primary" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">B</span>
          <div>
            <div className="text-lg font-semibold leading-tight tracking-tight">BouldLeads</div>
            <div className="text-xs text-muted">Sign in to your team workspace</div>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
