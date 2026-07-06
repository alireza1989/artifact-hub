import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

// Constant-time bearer check for write operations (CLAUDE.md security invariants).
// Length-guarded so timingSafeEqual never throws on mismatched buffer sizes.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isAuthorized(req: Request): boolean {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice("Bearer ".length), getEnv().ADMIN_API_TOKEN);
}
