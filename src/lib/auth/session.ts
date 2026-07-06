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
