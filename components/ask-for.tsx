"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";
import { Input, cx } from "./ui";
import { send } from "./use-api";
import { toast } from "./feedback";

// Who to ask for when someone else picks up: "Jamie answers, ask for Kenny". Click to edit.
export function AskFor({ id, value, onSaved, className }: { id: number; value: string | null | undefined; onSaved?: () => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saved, setSaved] = useState(value ?? "");
  const current = editing ? draft : saved || value || "";

  async function save() {
    setEditing(false);
    const v = draft.trim();
    if (v === (saved || value || "")) return;
    try {
      await send(`/api/leads/${id}`, "PATCH", { askFor: v || null });
      setSaved(v);
      onSaved?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  if (editing)
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="e.g. Jamie answers, ask for Kenny"
        maxLength={120}
        className={cx("h-7 text-xs", className)}
      />
    );
  return (
    <button
      onClick={() => (setDraft(current), setEditing(true))}
      className={cx("inline-flex items-center gap-1 text-left text-xs", current ? "font-semibold text-foreground" : "text-muted hover:text-accent", className)}
      title="Who to ask for when someone else answers"
    >
      <UserRound size={12} className="shrink-0" />
      {current ? `Ask for: ${current}` : "Add who to ask for"}
    </button>
  );
}
