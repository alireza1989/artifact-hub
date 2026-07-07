import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts, shareLinks } from "@/db/schema";
import { logger } from "@/lib/logger";
import { hashToken, parseToken, verifySignature } from "./token";

export type ShareVerifyResult =
  | { ok: true; artifact: Artifact; linkId: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

// `countAccess: false` resolves the token without bumping the access counter — used
// by the share-view comment write, which re-verifies the token to authorize the
// comment (never trusting a client-passed artifact id) but must not double-count a
// view the page GET already recorded. Defaults to true so a plain view still counts.
export type VerifyShareTokenOptions = { countAccess?: boolean };

// Resolve a share token to its artifact (PLAN §3.3), or a typed reason it failed
// so the Phase-3 viewer can show a friendly expired/revoked page rather than a 404.
// Order: format check → DB lookup by token hash → constant-time signature check →
// revocation → expiry → increment access counter. Returns the link's expiry so the
// viewer can render a live "expires in 2 days" countdown.
export async function verifyShareToken(
  token: string,
  { countAccess = true }: VerifyShareTokenOptions = {},
): Promise<ShareVerifyResult> {
  // Debug-level failure logging (hidden at prod's default info level; flip
  // LOG_LEVEL=debug to diagnose "my link doesn't work"). Only the failure
  // reason and the non-secret link id are logged — NEVER the token or its hash
  // (CLAUDE.md invariant: never log full tokens).
  const parsed = parseToken(token);
  if (!parsed) {
    logger.debug({ reason: "malformed" }, "share token rejected");
    return { ok: false, reason: "invalid" };
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.id !== parsed.linkId) {
    logger.debug(
      { reason: "unknown-or-mismatched", linkId: parsed.linkId },
      "share token rejected",
    );
    return { ok: false, reason: "invalid" };
  }
  if (!verifySignature(parsed.linkId, row.expiresAt.getTime(), parsed.signature)) {
    logger.debug({ reason: "bad-signature", linkId: parsed.linkId }, "share token rejected");
    return { ok: false, reason: "invalid" };
  }
  if (row.revokedAt) {
    logger.debug({ reason: "revoked", linkId: row.id }, "share token rejected");
    return { ok: false, reason: "revoked" };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    logger.debug({ reason: "expired", linkId: row.id }, "share token rejected");
    return { ok: false, reason: "expired" };
  }

  if (countAccess) {
    await db
      .update(shareLinks)
      .set({ accessCount: sql`${shareLinks.accessCount} + 1`, lastAccessedAt: new Date() })
      .where(eq(shareLinks.id, row.id));
  }

  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, row.artifactId))
    .limit(1);
  if (!artifact) return { ok: false, reason: "invalid" };
  return { ok: true, artifact, linkId: row.id, expiresAt: row.expiresAt };
}
