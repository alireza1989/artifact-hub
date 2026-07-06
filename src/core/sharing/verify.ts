import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts, shareLinks } from "@/db/schema";
import { hashToken, parseToken, verifySignature } from "./token";

export type ShareVerifyResult =
  | { ok: true; artifact: Artifact; linkId: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

// Resolve a share token to its artifact (PLAN §3.3), or a typed reason it failed
// so the Phase-3 viewer can show a friendly expired/revoked page rather than a 404.
// Order: format check → DB lookup by token hash → constant-time signature check →
// revocation → expiry → increment access counter.
export async function verifyShareToken(token: string): Promise<ShareVerifyResult> {
  const parsed = parseToken(token);
  if (!parsed) return { ok: false, reason: "invalid" };

  const db = getDb();
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.id !== parsed.linkId) return { ok: false, reason: "invalid" };
  if (!verifySignature(parsed.linkId, row.expiresAt.getTime(), parsed.signature)) {
    return { ok: false, reason: "invalid" };
  }
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  await db
    .update(shareLinks)
    .set({ accessCount: sql`${shareLinks.accessCount} + 1`, lastAccessedAt: new Date() })
    .where(eq(shareLinks.id, row.id));

  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, row.artifactId))
    .limit(1);
  if (!artifact) return { ok: false, reason: "invalid" };
  return { ok: true, artifact, linkId: row.id };
}
