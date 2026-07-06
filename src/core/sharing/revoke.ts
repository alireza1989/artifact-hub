import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shareLinks } from "@/db/schema";
import { ShareLinkNotFoundError } from "./errors";

export type RevokeResult = { linkId: string; revokedAt: Date; alreadyInactive: boolean };

// Revoke a link by id (PLAN §3.3). Idempotent: revoking an already-revoked link is
// a no-op returning the existing revocation time; `alreadyInactive` also flags a
// link that was already unusable (revoked or expired).
export async function revokeShareLink(linkId: string): Promise<RevokeResult> {
  const db = getDb();
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, linkId)).limit(1);
  if (!row) throw new ShareLinkNotFoundError(linkId);

  if (row.revokedAt) return { linkId, revokedAt: row.revokedAt, alreadyInactive: true };

  const expired = row.expiresAt.getTime() <= Date.now();
  const now = new Date();
  await db.update(shareLinks).set({ revokedAt: now }).where(eq(shareLinks.id, linkId));
  return { linkId, revokedAt: now, alreadyInactive: expired };
}
