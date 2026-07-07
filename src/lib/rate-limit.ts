// Best-effort in-memory fixed-window rate limiter for public endpoints (comment
// spam is the obvious abuse vector — PLAN §Phase 5). NOTE: state lives in process
// memory, so on Vercel Fluid Compute it is NOT shared across instances — it
// throttles the common case (one spammer landing on one instance) but is not a hard
// guarantee. Durable limiting (a KV/Postgres counter) is the Phase-5 hardening.
type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();
const MAX_BUCKETS = 10_000;

// Returns true if the call is allowed, false if the window's limit is exhausted.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic sweep so an unbounded key space (many IPs) can't grow forever.
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, w] of buckets) if (now >= w.resetAt) buckets.delete(k);
  }

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}
