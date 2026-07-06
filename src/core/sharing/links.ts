import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shareLinks } from "@/db/schema";

// Non-sensitive per-artifact link summary for get_artifact. The token is NOT
// recoverable from the stored hash, so only ids/status/expiry are exposed — enough
// for revoke_share_link's discovery path, nothing that leaks a working URL.
export type ShareLinkSummary = {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  accessCount: number;
};

export async function listShareLinks(artifactId: string): Promise<ShareLinkSummary[]> {
  return getDb()
    .select({
      id: shareLinks.id,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      accessCount: shareLinks.accessCount,
    })
    .from(shareLinks)
    .where(eq(shareLinks.artifactId, artifactId))
    .orderBy(desc(shareLinks.createdAt));
}
