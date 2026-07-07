import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts } from "@/db/schema";
import type { PublishMetadata } from "@/lib/validation";
import { ArtifactNotFoundError } from "./errors";

// Owner edit of the AI-suggested (or any) metadata (PLAN §5.1: suggestions are
// editable). Only title/description/tags change. aiGeneratedMeta is intentionally
// left intact as the audit of what the AI suggested; the "suggested" badge simply
// disappears for a field once its value no longer matches the recorded suggestion.
export async function updateArtifactMetadata(
  id: string,
  metadata: PublishMetadata,
): Promise<Artifact> {
  const set: Partial<Pick<Artifact, "title" | "description" | "tags" | "updatedAt">> = {
    updatedAt: new Date(),
  };
  if (metadata.title !== undefined) set.title = metadata.title;
  if (metadata.description !== undefined) set.description = metadata.description;
  if (metadata.tags !== undefined) set.tags = metadata.tags;

  const [row] = await getDb().update(artifacts).set(set).where(eq(artifacts.id, id)).returning();
  if (!row) throw new ArtifactNotFoundError(id);
  return row;
}
