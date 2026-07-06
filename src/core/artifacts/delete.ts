import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { artifacts } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Storage } from "@/lib/storage";
import { getStorage } from "@/lib/storage";
import { ArtifactNotFoundError } from "./errors";

// Delete the DB row first (source of truth; cascades to comments, feedback,
// share_links). Blob removal is best-effort — an orphaned blob is harmless and
// must not fail the delete or leave the row behind.
export async function deleteArtifact(id: string, storage: Storage = getStorage()): Promise<void> {
  const [deleted] = await getDb()
    .delete(artifacts)
    .where(eq(artifacts.id, id))
    .returning({ blobUrl: artifacts.blobUrl });

  if (!deleted) throw new ArtifactNotFoundError(id);

  try {
    await storage.delete(deleted.blobUrl);
  } catch (error) {
    logger.warn(
      { err: error, artifactId: id },
      "artifact blob delete failed (row already removed)",
    );
  }
}
