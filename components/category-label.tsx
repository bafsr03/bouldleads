"use client";

import { Check, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUSINESS_TYPES, GROUPS } from "@/lib/discovery/categories";
import { Button, Input, Select, cx } from "./ui";
import { send } from "./use-api";
import { toast } from "./feedback";

// A lead's business type. Google leads whose type is only the search term (a pawn shop found by
// "motorcycle dealer") show a "?" until someone checks the Google profile and sets it here.

const UNCONFIRMED_HINT = "Not confirmed by Google: this is what the search was for. Check their Google profile and click to fix.";

/** Read-only label for lists: "Motorcycles & powersports?" when unconfirmed. */
export function CategoryText({ category, confirmed }: { category: string | null; confirmed?: number | null }) {
  if (!category) return null;
  return confirmed === 0 ? (
    <span className="italic opacity-80" title={UNCONFIRMED_HINT}>
      {category}?
    </span>
  ) : (
    <>{category}</>
  );
}

/** Label with an inline picker to set the real type. */
export function CategoryLabel({ id, category, confirmed, onSaved }: { id: number; category: string | null; confirmed: number | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unconfirmed = confirmed === 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function save(value: string) {
    setBusy(true);
    try {
      await send(`/api/leads/${id}`, "PATCH", { category: value });
      toast(`Type set to ${value}. Re-auditing with it.`);
      setOpen(false);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const value = custom.trim() || pick;
  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        onClick={() => {
          setPick(BUSINESS_TYPES.some((t) => t.label === category) ? category! : "");
          setCustom("");
          setOpen((o) => !o);
        }}
        className={cx(
          "inline-flex items-center gap-1 rounded hover:text-foreground",
          unconfirmed && "rounded-md border border-dashed border-yellow-500/70 px-1.5 text-yellow-700 dark:text-yellow-300",
        )}
        title={unconfirmed ? UNCONFIRMED_HINT : "Change the business type"}
      >
        {category ?? "Set type"}
        {unconfirmed ? "?" : <Pencil size={11} className="opacity-50" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-border bg-surface p-3 text-sm text-foreground shadow-lg">
          <div className="mb-2 text-xs font-medium">What do they really do?</div>
          {unconfirmed && <p className="mb-2 text-xs text-muted">Open their Google profile: the type under the name (e.g. &ldquo;Pawn shop&rdquo;) is the one to pick.</p>}
          <Select value={pick} onChange={(e) => (setPick(e.target.value), setCustom(""))} className="mb-2 h-8 w-full">
            <option value="">Pick a type…</option>
            {GROUPS.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {BUSINESS_TYPES.filter((t) => t.group === g.id).map((t) => (
                  <option key={t.id} value={t.label}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="…or type it: Pawn shop" className="mb-2 h-8" maxLength={80} />
          <div className="flex justify-end gap-2">
            {unconfirmed && category && (
              <Button size="sm" disabled={busy} onClick={() => save(category)} title="The search type is right">
                Keep {category.length > 18 ? "it" : category}
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={busy || !value} onClick={() => save(value)}>
              <Check size={13} /> Save
            </Button>
          </div>
        </div>
      )}
    </span>
  );
}
