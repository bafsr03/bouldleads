import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, readSession } from "@/lib/auth";

// Everything requires a login when APP_USERS is set, except the login itself and the cron endpoint
// (which checks its own CRON_SECRET).
const OPEN = ["/login", "/api/auth/", "/api/cron/"];

export function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (OPEN.some((p) => path === p || path.startsWith(p))) return NextResponse.next();
  let user: string | null = null;
  try {
    user = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    user = null; // SESSION_SECRET missing: nobody gets in until it's set
  }
  if (user) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|ico|css|js)$).*)"],
};
