"use client";

import { CalendarClock, CircleHelp, FileUp, Inbox, LayoutDashboard, LogOut, Map, MailCheck, MapPin, Megaphone, PhoneCall, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ago, cx } from "./ui";
import { send, useApi } from "./use-api";
import { WelcomeTour, openWelcomeTour } from "./welcome-tour";
import { useEmailOn } from "./use-flags";
import { countsText, useCallbackAlerts } from "./today-agenda";

const EMAIL_PAGES = ["/campaigns", "/replies", "/inboxes"];

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/calls", label: "Call list", icon: PhoneCall },
  { href: "/callbacks", label: "Callbacks", icon: CalendarClock },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/places", label: "Places", icon: Map },
  { href: "/search", label: "Find leads", icon: MapPin },
  { href: "/import", label: "Meta leads", icon: FileUp },
  { href: "/campaigns", label: "Emails", icon: Megaphone },
  { href: "/replies", label: "Replies", icon: MailCheck },
  { href: "/inboxes", label: "Inboxes", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Stats = { workerOnline: boolean; lastTick: number | null; replied: number; callbacksDue: number };

export function Nav() {
  const path = usePathname();
  const hidden = path === "/login";
  const emailOn = useEmailOn();
  const { data } = useApi<Stats>(hidden ? null : "/api/stats", 15_000);
  const { data: me } = useApi<{ user: string | null; authEnabled: boolean; onboarded: boolean }>(hidden ? null : "/api/auth/me");
  const cb = useCallbackAlerts(!hidden); // the nav is on every page, so callback reminders work wherever you are
  if (hidden) return null;

  async function signOut() {
    await send("/api/auth/logout", "POST");
    window.location.replace("/login"); // full reload: drop every cached view
  }

  // Callbacks badge: new requests + overdue + due today, the same numbers as Today's to-do (orange while a request waits).
  const badge = (href: string) => (href === "/replies" ? data?.replied : href === "/callbacks" ? (cb ? cb.requests + cb.overdue + cb.today : 0) : 0);

  return (
    <aside className="flex shrink-0 flex-col border-b border-border bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">B</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-tight tracking-tight">BouldLeads</div>
          <div
            className="flex items-center gap-1.5 text-xs text-muted"
            title={data?.workerOnline === false ? "Searches, email finding and sending run in the background. Locally: npm run dev. Hosted: the every-minute cron job." : undefined}
          >
            {data ? (
              <>
                <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", data.workerOnline ? "bg-emerald-500" : "bg-red-500")} />
                <span className="truncate">{data.workerOnline ? `Background: ${ago(data.lastTick)}` : "Background tasks stopped"}</span>
              </>
            ) : (
              "Lead finder & outreach"
            )}
          </div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:pb-0">
        {LINKS.filter((l) => emailOn || !EMAIL_PAGES.includes(l.href)).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`); // "/calls" isn't "/callbacks"
          const n = badge(href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-background hover:text-foreground",
              )}
            >
              <Icon size={16} strokeWidth={active ? 2.25 : 1.75} />
              {label}
              {!!n && (
                <span
                  className={cx(
                    "ml-auto rounded-full px-1.5 text-[11px] font-semibold",
                    href === "/callbacks" ? (cb?.requests ? "bg-orange-500 text-white" : "bg-yellow-400 text-zinc-900") : "bg-accent text-white",
                  )}
                  title={href === "/callbacks" ? (cb ? countsText(cb) : "Callbacks due") : "Replies"}
                >
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={openWelcomeTour}
        className="mx-3 mb-2 hidden items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-background hover:text-foreground md:flex"
      >
        <CircleHelp size={16} strokeWidth={1.75} /> Guide
      </button>
      {me && <WelcomeTour user={me.user} autoOpen={!me.onboarded} emailOn={!!emailOn} />}
      {me?.user && (
        <div className="hidden items-center justify-between border-t border-border px-5 py-3 text-sm md:flex">
          <span className="truncate">
            <span className="text-muted">Signed in as </span>
            <span className="font-medium">{me.user}</span>
          </span>
          <button onClick={signOut} className="rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground" title="Sign out" aria-label="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
