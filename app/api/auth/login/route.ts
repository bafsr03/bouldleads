import { cookies } from "next/headers";
import { bad, body, json } from "@/lib/api";
import { SESSION_COOKIE, authEnabled, checkLogin, makeSession } from "@/lib/auth";

const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  if (!authEnabled()) return json({ ok: true });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const a = attempts.get(ip);
  if (a && a.n >= 8 && a.until > Date.now()) return bad("Too many attempts. Try again in a few minutes.", 429);
  const { name, password } = await body<{ name?: string; password?: string }>(req);
  const user = checkLogin(name ?? "", password ?? "");
  if (!user) {
    attempts.set(ip, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60_000 });
    return bad("Wrong name or password.", 401);
  }
  attempts.delete(ip);
  const s = makeSession(user);
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: s.maxAge,
  });
  return json({ ok: true, user });
}
