"use client";

import { MoreHorizontal, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button, Card, Input, PageHeader, Select, StatusBadge, cx, fmt } from "@/components/ui";
import { confirmDialog, confirmWithOption, toast } from "@/components/feedback";
import { send, useApi } from "@/components/use-api";
import { useEmailOn } from "@/components/use-flags";
import { CategoryText } from "@/components/category-label";
import { PitchBadge, Rating, STAGES, ScorePair, SiteChip, StageBadge, TierBadge } from "@/components/score";

type Lead = {
  id: number;
  name: string;
  category: string | null;
  category_confirmed: number | null;
  city: string | null;
  country_code: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  email_source: string | null;
  email_confidence: number | null;
  status: string;
  rating: number | null;
  review_count: number | null;
  audit_status: string | null;
  visibility_score: number | null;
  conversion_score: number | null;
  tier: string | null;
  stage: string;
  top_issue: string | null;
  pitch: string | null;
  site_state: string | null;
  site_label: string | null;
  social_url: string | null;
};

type SearchRow = { id: number; label: string; place: string | null; leads: number };

const STATUSES: [string, string][] = [
  ["all", "All"],
  ["verified", "With email"],
  ["pending", "Finding email"],
  ["no_email", "No email"],
  ["no_website", "No website"],
  ["invalid", "Invalid"],
  ["excluded", "Excluded"],
];

const FILTERS = ["status", "place", "searchId", "stage", "tier", "type", "sort", "q"] as const;
type Filters = Record<(typeof FILTERS)[number], string>;

const hostname = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function RowMenu({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function act(action: "exclude" | "include" | "delete") {
    setOpen(false);
    if (action === "delete") {
      const r = await confirmWithOption({
        title: `Delete ${lead.name}?`,
        body: "Removes the lead, its calls and any scheduled emails.",
        confirmLabel: "Delete",
        danger: true,
        checkbox: { label: "Don't add it back in future searches", checked: true },
      });
      if (!r.ok) return;
      await send(`/api/leads/${lead.id}?remember=${r.checked ? 1 : 0}`, "DELETE");
      toast(`${lead.name} deleted.`);
    } else {
      await send("/api/leads", "PATCH", { ids: [lead.id], action });
      toast(`${lead.name} ${action === "exclude" ? "excluded from emails" : "re-included"}.`);
    }
    onChanged();
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground" aria-label="Lead actions">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-surface p-1 text-sm shadow-lg">
          <Link href={`/leads/${lead.id}`} className="block rounded-md px-3 py-1.5 hover:bg-background">
            Open lead
          </Link>
          {lead.status === "excluded" ? (
            <button onClick={() => act("include")} className="block w-full rounded-md px-3 py-1.5 text-left hover:bg-background">
              Re-include
            </button>
          ) : (
            <button onClick={() => act("exclude")} className="block w-full rounded-md px-3 py-1.5 text-left hover:bg-background">
              Exclude from emails
            </button>
          )}
          <button onClick={() => act("delete")} className="block w-full rounded-md px-3 py-1.5 text-left text-red-700 hover:bg-background dark:text-red-400">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function LeadsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const f = Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? ""])) as Filters;
  f.status ||= "all";
  f.sort ||= "priority";
  const [q, setQ] = useState(f.q);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const emailOn = useEmailOn();

  const setFilters = (patch: Partial<Filters>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && !(k === "status" && v === "all") && !(k === "sort" && v === "priority")) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`/leads${p.size ? `?${p}` : ""}`, { scroll: false });
    setPage(0);
    setSelected(new Set());
    setAllMatching(false);
  };

  useEffect(() => {
    if (q === f.q) return;
    const t = setTimeout(() => setFilters({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const { data: types } = useApi<{ type: string; total: number; verified: number }[]>("/api/leads/types", 30_000);
  const { data: searches } = useApi<SearchRow[]>("/api/searches", 30_000);
  const { data, reload } = useApi<{ total: number; pageSize: number; rows: Lead[] }>(`/api/leads?${new URLSearchParams({ ...query, page: String(page) })}`, 10_000);
  const rows = data?.rows ?? [];
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const places = [...new Set((searches ?? []).map((s) => s.place).filter((p): p is string => !!p))];
  const placeSearches = (searches ?? []).filter((s) => !f.place || s.place === f.place);
  const pageAllSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const count = allMatching ? (data?.total ?? 0) : selected.size;
  const selection = allMatching ? { filter: query } : { ids: [...selected] };
  const plural = (n: number) => `${fmt(n)} lead${n === 1 ? "" : "s"}`;

  const done = () => {
    setSelected(new Set());
    setAllMatching(false);
    reload();
  };

  async function bulk(action: "exclude" | "include" | "retry" | "audit" | "followup") {
    if (
      action === "exclude" &&
      !(await confirmDialog({
        title: `Exclude ${plural(count)} from emails?`,
        body: "Excluded leads are never emailed. They stay in the call list and can be re-included from the Excluded tab.",
        confirmLabel: "Exclude",
      }))
    )
      return;
    if (
      action === "followup" &&
      !(await confirmDialog({
        title: `Email ${plural(count)}?`,
        body: "Starts the no-answer follow-up (4 emails over 12 days) for every selected lead with a verified email. Use it for leads you already tried to call.",
        confirmLabel: "Start emails",
      }))
    )
      return;
    try {
      const r = await send<{ changed: number; selected: number }>("/api/leads", "PATCH", { ...selection, action });
      const verb = { exclude: "excluded", include: "re-included", retry: "queued for another email search", audit: "queued for an audit", followup: "started on the email follow-up" }[action];
      toast(`${plural(r.changed)} ${verb}${r.changed < r.selected ? ` (${fmt(r.selected - r.changed)} skipped)` : ""}.`);
      done();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function remove() {
    const r = await confirmWithOption({
      title: `Delete ${plural(count)}?`,
      body: "Removes them with their call history and any scheduled emails. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
      checkbox: { label: "Don't add them back when we search these areas again", checked: true },
    });
    if (!r.ok) return;
    const res = await send<{ deleted: number }>("/api/leads", "DELETE", { ...selection, remember: r.checked });
    toast(`${plural(res.deleted)} deleted.`);
    done();
  }

  const chips: [keyof Filters, string][] = [];
  if (f.place) chips.push(["place", f.place]);
  if (f.searchId) chips.push(["searchId", searches?.find((s) => String(s.id) === f.searchId)?.label ?? `Search #${f.searchId}`]);
  if (f.stage) chips.push(["stage", STAGES.find((s) => s.value === f.stage)?.label ?? f.stage]);
  if (f.tier) chips.push(["tier", f.tier === "unscored" ? "Not audited" : f.tier === "not_fit" ? "Not a fit" : `Tier ${f.tier === "AB" ? "A + B" : f.tier}`]);
  if (f.type) chips.push(["type", f.type]);
  if (f.q) chips.push(["q", `“${f.q}”`]);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every business found, organised by place and search. Open one for its audit and call brief; select several to email, audit, exclude or delete them."
        actions={
          <a href={`/api/leads/export?${new URLSearchParams(query)}`}>
            <Button>Export CSV</Button>
          </a>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="sm:w-48" value={f.place} onChange={(e) => setFilters({ place: e.target.value, searchId: "" })} aria-label="Place">
          <option value="">All places</option>
          {places.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select className="sm:w-64" value={f.searchId} onChange={(e) => setFilters({ searchId: e.target.value })} aria-label="Search">
          <option value="">All searches{f.place ? ` in ${f.place}` : ""}</option>
          {placeSearches.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.id} {s.label} ({fmt(s.leads)})
            </option>
          ))}
        </Select>
        <Select className="sm:w-40" value={f.stage} onChange={(e) => setFilters({ stage: e.target.value })} aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select className="sm:w-36" value={f.tier} onChange={(e) => setFilters({ tier: e.target.value })} aria-label="Tier">
          <option value="">All tiers</option>
          <option value="AB">Tier A + B</option>
          <option value="A">Tier A</option>
          <option value="B">Tier B</option>
          <option value="C">Tier C</option>
          <option value="not_fit">Not a fit</option>
          <option value="unscored">Not audited yet</option>
        </Select>
        <Select className="sm:w-52" value={f.type} onChange={(e) => setFilters({ type: e.target.value })} aria-label="Business type">
          <option value="">All business types</option>
          {types?.map((t) => (
            <option key={t.type} value={t.type}>
              {t.type} ({fmt(t.total)})
            </option>
          ))}
        </Select>
        <Select className="sm:w-40" value={f.sort} onChange={(e) => setFilters({ sort: e.target.value })} aria-label="Sort">
          <option value="priority">Best leads first</option>
          <option value="newest">Newest first</option>
          <option value="called">Recently called</option>
        </Select>
        <Input className="sm:w-56" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {STATUSES.map(([s, label]) => (
          <button
            key={s}
            onClick={() => setFilters({ status: s })}
            className={cx("rounded-lg px-3 py-1.5 text-sm", f.status === s ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface")}
          >
            {label}
          </button>
        ))}
        {chips.length > 0 && <span className="mx-1 h-5 w-px bg-border" />}
        {chips.map(([k, label]) => (
          <button
            key={k}
            onClick={() => (k === "q" && setQ(""), setFilters({ [k]: "" }))}
            className="inline-flex max-w-64 items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:border-accent"
            title="Remove filter"
          >
            <span className="truncate">{label}</span>
            <X size={12} />
          </button>
        ))}
        {chips.length > 1 && (
          <button onClick={() => (setQ(""), setFilters(Object.fromEntries(chips.map(([k]) => [k, ""]))))} className="px-2 text-xs text-muted hover:text-foreground">
            Clear all
          </button>
        )}
      </div>

      {count > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-surface px-3 py-2 text-sm shadow-sm">
          <span className="font-medium">{plural(count)} selected</span>
          {!allMatching && pageAllSelected && data && data.total > rows.length && (
            <button className="text-accent hover:underline" onClick={() => setAllMatching(true)}>
              Select all {fmt(data.total)} matching
            </button>
          )}
          <button className="text-muted hover:text-foreground" onClick={() => (setSelected(new Set()), setAllMatching(false))}>
            Clear
          </button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {emailOn && (
              <Button size="sm" onClick={() => bulk("followup")} title="Start the no-answer email follow-up">
                Start emails
              </Button>
            )}
            <Button size="sm" onClick={() => bulk("audit")}>Run audit</Button>
            <Button size="sm" onClick={() => bulk("retry")}>Find email again</Button>
            {f.status === "excluded" ? (
              <Button size="sm" onClick={() => bulk("include")}>Re-include</Button>
            ) : (
              <Button size="sm" onClick={() => bulk("exclude")}>Exclude</Button>
            )}
            <Button size="sm" variant="danger" onClick={remove}>
              <Trash2 size={13} /> Delete
            </Button>
          </div>
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-8 p-3">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  aria-label="Select page"
                  checked={pageAllSelected}
                  onChange={(e) => {
                    setAllMatching(false);
                    setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set());
                  }}
                />
              </th>
              <th className="p-3">Business</th>
              <th className="p-3">Audit</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Stage</th>
              <th className="w-8 p-3" />
            </tr>
          </thead>
          <tbody>
            {!data &&
              [0, 1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-border/60">
                  <td colSpan={6} className="p-3">
                    <div className="h-8 animate-pulse rounded bg-background" />
                  </td>
                </tr>
              ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-10 text-center text-muted">
                  {chips.length || f.status !== "all" ? (
                    "No leads match these filters."
                  ) : (
                    <>
                      No leads yet.{" "}
                      <Link href="/search" className="text-accent hover:underline">
                        Find businesses
                      </Link>{" "}
                      to get started.
                    </>
                  )}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={cx("border-b border-border/60 last:border-0 hover:bg-background/60", (allMatching || selected.has(r.id)) && "bg-accent-soft/40")}>
                <td className="p-3 align-top">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    aria-label={`Select ${r.name}`}
                    checked={allMatching || selected.has(r.id)}
                    onChange={(e) => {
                      const n = new Set(allMatching ? rows.map((x) => x.id) : selected);
                      if (e.target.checked) n.add(r.id);
                      else n.delete(r.id);
                      setAllMatching(false);
                      setSelected(n);
                    }}
                  />
                </td>
                <td className="p-3 align-top">
                  <Link href={`/leads/${r.id}`} className="font-medium hover:text-accent hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted">
                    <CategoryText category={r.category} confirmed={r.category_confirmed} />
                    {r.category && (r.city || r.country_code) && " · "}
                    {[r.city, r.country_code].filter(Boolean).join(", ")}
                    {r.review_count != null && (
                      <>
                        {" · "}
                        <Rating rating={r.rating} count={r.review_count} />
                      </>
                    )}
                  </div>
                  {r.website && (
                    <a href={r.website} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                      {hostname(r.website)}
                    </a>
                  )}
                </td>
                <td className="max-w-72 p-3 align-top">
                  {r.tier ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <TierBadge tier={r.tier} short />
                        <PitchBadge pitch={r.pitch} />
                        <SiteChip state={r.site_state} label={r.site_label} website={r.website} socialUrl={r.social_url} />
                        <ScorePair v={r.visibility_score} c={r.conversion_score} />
                      </div>
                      {r.top_issue && <div className="mt-1 line-clamp-2 text-xs text-muted">{r.top_issue}</div>}
                    </>
                  ) : (
                    <span className="text-xs text-muted">
                      {r.audit_status === "queued" || r.audit_status === "running"
                        ? "Auditing…"
                        : r.audit_status === "failed"
                          ? "Audit failed"
                          : r.status === "pending"
                            ? "After email search"
                            : "Not audited"}
                    </span>
                  )}
                </td>
                <td className="p-3 align-top text-xs">
                  {r.email ? (
                    <button
                      className="block font-mono hover:text-accent"
                      title={`Copy email${r.email_confidence != null ? ` (confidence ${r.email_confidence})` : ""}`}
                      onClick={() => navigator.clipboard.writeText(r.email!).then(() => toast("Email copied.", "info"))}
                    >
                      {r.email}
                    </button>
                  ) : (
                    <span className="block text-muted">No email</span>
                  )}
                  {r.phone && <span className="text-muted">{r.phone}</span>}
                </td>
                <td className="p-3 align-top">
                  <div className="flex flex-col items-start gap-1">
                    {r.phone && <StageBadge stage={r.stage} />}
                    <StatusBadge status={r.status} />
                  </div>
                </td>
                <td className="p-3 align-top">
                  <RowMenu lead={r} onChanged={reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>{plural(data?.total ?? 0)}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              {page + 1} / {pages}
            </span>
            <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsInner />
    </Suspense>
  );
}
