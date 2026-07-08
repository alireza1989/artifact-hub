import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

// Minimal single-team session (PLAN §3.4): the web UI stores the admin token in
// an httpOnly cookie after a one-time unlock, gating write actions. No accounts.
const SESSION_COOKIE = "ah_session";

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function hasValidSession(): Promise<boolean> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value != null && constantTimeEqual(value, getEnv().ADMIN_API_TOKEN);
}

// Session check for Route Handlers that receive the Request directly (e.g.
// /raw/[id]): reads the cookie off the request instead of next/headers, so the
// handler stays callable with a plain Request in integration tests.
export function requestHasValidSession(req: Request): boolean {
  const header = req.headers.get("cookie");
  if (!header) return false;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    return constantTimeEqual(
      decodeURIComponent(part.slice(eq + 1).trim()),
      getEnv().ADMIN_API_TOKEN,
    );
  }
  return false;
}

// Validate a submitted token and, if correct, persist the session cookie. Must be
// called from a Server Action or Route Handler (cookie writes are not allowed
// during render). Returns whether the token was accepted.
export async function createSession(token: string): Promise<boolean> {
  if (!constantTimeEqual(token, getEnv().ADMIN_API_TOKEN)) return false;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// Post-unlock redirect target (?next=...). Only same-site paths — anything else
// ("https://evil.example", "//evil.example") would make /unlock an open redirect.
export function safeNextPath(next: string | undefined | null): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}
