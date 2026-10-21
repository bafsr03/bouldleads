"use client";

import { Check, ChevronDown, ChevronRight, Plus, Search, Tag, Type, X } from "lucide-react";
import { useMemo, useState } from "react";
import { BUSINESS_TYPES, GROUPS, describeSelection, parseTagToken } from "@/lib/discovery/categories";
import { cx } from "./ui";

const POPULAR = ["smoke_shop", "vape_shop", "restaurant", "dentist", "hair_salon", "barber", "gym", "car_repair", "real_estate", "builder"];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Searchable, grouped business-type picker with "all businesses" and custom keyword/tag entries. */
export function TypePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = value.includes("all");
  const has = (tok: string) => value.includes(tok);
  const toggle = (tok: string) => onChange(has(tok) ? value.filter((v) => v !== tok) : [...value.filter((v) => v !== "all"), tok]);
  const groupOn = (g: string) => all || has(`group:${g}`);

  function toggleGroup(g: string) {
    const ids = new Set(BUSINESS_TYPES.filter((x) => x.group === g).map((x) => x.id));
    // Selecting a group replaces its individual types with one group token.
    const rest = value.filter((v) => v !== "all" && v !== `group:${g}` && !ids.has(v));
    onChange(groupOn(g) ? rest : [...rest, `group:${g}`]);
  }

  const q = norm(query.trim());
  const matches = useMemo(
    () =>
      q
        ? BUSINESS_TYPES.filter((x) => norm(`${x.label} ${x.google.join(" ")} ${(x.names ?? []).join(" ")} ${x.id}`).includes(q))
        : BUSINESS_TYPES,
    [q],
  );
  const tagLike = /^[a-z][a-z0-9_:]*=[a-z0-9 _.\-:]+$/i.test(query.trim());
  const custom = query.trim().length >= 2 ? (tagLike ? `tag:${query.trim()}` : `kw:${query.trim()}`) : null;
  const customValid = custom && (!custom.startsWith("tag:") || parseTagToken(custom));

  function addCustom() {
    if (!custom || !customValid || has(custom)) return;
    onChange([...value.filter((v) => v !== "all"), custom]);
    setQuery("");
  }

  const customTokens = value.filter((v) => v.startsWith("kw:") || v.startsWith("tag:"));
  const groupTokens = value.filter((v) => v.startsWith("group:"));
  const typeTokens = value.filter((v) => !v.includes(":") && v !== "all");

  return (
    <div className="space-y-3">
      <label
        className={cx(
          "flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
          all ? "border-accent bg-accent-soft" : "border-border hover:bg-background",
        )}
      >
        <span>
          <span className="font-medium">All businesses</span>
          <span className="block text-xs text-muted">Every shop, office, trade, clinic, venue… (OpenStreetMap only). Picking specific types with Google finds better, more callable leads.</span>
        </span>
        <input type="checkbox" className="accent-[var(--accent)]" checked={all} onChange={() => onChange(all ? [] : ["all"])} />
      </label>

      {value.length > 0 && !all && (
        <div className="flex flex-wrap gap-1.5">
          {[...groupTokens, ...typeTokens, ...customTokens].map((tok) => (
            <span key={tok} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent">
              {tok.startsWith("kw:") ? <Type size={12} /> : tok.startsWith("tag:") ? <Tag size={12} /> : null}
              {describeSelection([tok])}
              <button aria-label="Remove" onClick={() => onChange(value.filter((v) => v !== tok))} className="opacity-70 hover:opacity-100">
                <X size={12} />
              </button>
            </span>
          ))}
          <button className="px-1 text-xs text-muted hover:text-foreground" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches.length === 1 && !has(matches[0].id)) {
                toggle(matches[0].id);
                setQuery("");
              } else addCustom();
            }
          }}
          placeholder="Search 110+ types, or type any keyword…"
          className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {!q && (
        <div className="flex flex-wrap gap-1.5">
          {POPULAR.map((id) => {
            const type = BUSINESS_TYPES.find((x) => x.id === id)!;
            const on = has(id) || groupOn(type.group);
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                disabled={groupOn(type.group)}
                className={cx(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:border-accent hover:text-foreground",
                )}
              >
                {type.label}
              </button>
            );
          })}
        </div>
      )}

      {custom && (
        <button
          onClick={addCustom}
          disabled={!customValid || has(custom)}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm hover:border-accent disabled:opacity-50"
        >
          <Plus size={14} className="text-accent" />
          {custom.startsWith("tag:") ? (
            <span>
              Add OpenStreetMap tag <code className="font-mono">{custom.slice(4)}</code>
            </span>
          ) : (
            <span>
              Add custom type: business name contains <b>“{custom.slice(3)}”</b>
            </span>
          )}
        </button>
      )}

      <div className="max-h-[340px] overflow-y-auto rounded-lg border border-border">
        {GROUPS.map((g) => {
          const items = matches.filter((x) => x.group === g.id);
          if (items.length === 0) return null;
          const expanded = !!q || open.has(g.id);
          const selectedCount = groupOn(g.id) ? items.length : items.filter((x) => has(x.id)).length;
          return (
            <div key={g.id} className="border-b border-border last:border-0">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  className="flex flex-1 items-center gap-1.5 text-left text-sm font-medium"
                  onClick={() => setOpen((o) => (o.has(g.id) ? new Set([...o].filter((x) => x !== g.id)) : new Set([...o, g.id])))}
                >
                  {expanded ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                  {g.label}
                  {selectedCount > 0 && <span className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">{selectedCount}</span>}
                </button>
                <button
                  onClick={() => toggleGroup(g.id)}
                  disabled={all}
                  className={cx("text-xs", groupOn(g.id) ? "text-accent" : "text-muted hover:text-foreground")}
                >
                  {groupOn(g.id) ? "✓ All selected" : "Select all"}
                </button>
              </div>
              {expanded && (
                <div className="grid grid-cols-1 gap-x-3 px-3 pb-2 sm:grid-cols-2">
                  {items.map((x) => {
                    const on = groupOn(g.id) || has(x.id);
                    return (
                      <button
                        key={x.id}
                        disabled={groupOn(g.id)}
                        onClick={() => toggle(x.id)}
                        className="flex items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-background disabled:cursor-default"
                      >
                        <span
                          className={cx(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            on ? "border-accent bg-accent text-white" : "border-border",
                          )}
                        >
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                        {x.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {matches.length === 0 && <p className="px-3 py-4 text-sm text-muted">No catalog type matches. Add it as a custom keyword above.</p>}
      </div>
    </div>
  );
}
