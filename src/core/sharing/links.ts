import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts, shareLinks } from "@/db/schema";

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

// Platform-wide link inventory for the admin console (PLAN Phase 6.5): every
// link across every artifact in one paginated view, newest first, joined with
// the artifact it opens so the admin can tell links apart. Same non-sensitive
// field set as ShareLinkSummary — a working URL is never recoverable here.
export type PlatformShareLink = ShareLinkSummary & {
  artifactId: string;
  artifactTitle: string;
  createdAt: Date;
  lastAccessedAt: Date | null;
};

export type PlatformShareLinkPage = {
  items: PlatformShareLink[];
  total: number;
  limit: number;
  offset: number;
};

export async function listAllShareLinks(
  { limit, offset }: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<PlatformShareLinkPage> {
  const db = getDb();
  const items = await db
    .select({
      id: shareLinks.id,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      accessCount: shareLinks.accessCount,
      artifactId: shareLinks.artifactId,
      artifactTitle: artifacts.title,
      createdAt: shareLinks.createdAt,
      lastAccessedAt: shareLinks.lastAccessedAt,
    })
    .from(shareLinks)
    .innerJoin(artifacts, eq(shareLinks.artifactId, artifacts.id))
    .orderBy(desc(shareLinks.createdAt))
    .limit(limit)
    .offset(offset);
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(shareLinks);
  return { items, total: countRow?.total ?? 0, limit, offset };
}
