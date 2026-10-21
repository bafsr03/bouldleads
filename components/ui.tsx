import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-border bg-surface p-5", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };

export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-accent text-white hover:opacity-90",
        variant === "secondary" && "border border-border bg-surface hover:bg-background",
        variant === "ghost" && "hover:bg-background",
        variant === "danger" && "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
        className,
      )}
    />
  );
}

const field =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx(field, "h-9", className)} />
);
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx(field, "py-2 leading-relaxed", className)} />
);
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(field, "h-9", className)} />
);

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 block text-sm font-medium">
      {children}
      {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
    </span>
  );
}

const tones: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export type Tone = keyof typeof tones;

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export const STATUS_TONE: Record<string, keyof typeof tones> = {
  verified: "green",
  active: "green",
  done: "green",
  completed: "blue",
  replied: "green",
  pending: "amber",
  queued: "amber",
  running: "blue",
  in_sequence: "blue",
  paused: "amber",
  draft: "gray",
  no_email: "gray",
  no_website: "gray",
  excluded: "gray",
  skipped: "gray",
  cancelled: "gray",
  invalid: "red",
  failed: "red",
  bounced: "red",
  unsubscribed: "red",
};

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={STATUS_TONE[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>
);

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "green" | "blue"; children: ReactNode }) {
  const t = {
    amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    red: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
    green: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
    blue: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  }[tone];
  return <div className={cx("rounded-lg border px-4 py-3 text-sm", t)}>{children}</div>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
export const ago = (ms: number | null | undefined) => {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
};
