import { eq } from "drizzle-orm";
import { suggestMetadata } from "@/core/ai";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts } from "@/db/schema";
import { getStorage, type Storage } from "@/lib/storage";
import { MAX_ARTIFACT_BYTES } from "@/lib/validation";
import { ArtifactNotFoundError } from "./errors";
import { getArtifactContent } from "./get";

export type RegenerateMetadataResult =
  | { regenerated: true; artifact: Artifact }
  | { regenerated: false };

// Re-run Feature A on an existing artifact (PLAN Phase 6.6): the owner explicitly
// asks for fresh suggestions, so — unlike publish, which fills only omitted
// fields — the whole suggestion is applied and recorded in aiGeneratedMeta. That
// makes every field show its "suggested" badge again, and editing any field
// afterwards clears its badge (the existing mechanism, PLAN §5.1). Same guardrail
// stack + telemetry as publish; a fallback/budget/error outcome changes nothing.
export async function regenerateMetadata(
  id: string,
  storage: Storage = getStorage(),
): Promise<RegenerateMetadataResult> {
  const { artifact, bytes } = await getArtifactContent(id, storage);
  if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) return { regenerated: false };

  const suggestion = await suggestMetadata({
    bytes,
    kind: artifact.kind,
    contentType: artifact.contentType,
  });
  if (!suggestion.aiGenerated) return { regenerated: false };

  const [row] = await getDb()
    .update(artifacts)
    .set({
      title: suggestion.title,
      description: suggestion.description,
      tags: suggestion.tags,
      aiGeneratedMeta: {
        title: suggestion.title,
        description: suggestion.description,
        tags: suggestion.tags,
      },
      updatedAt: new Date(),
    })
    .where(eq(artifacts.id, id))
    .returning();
  if (!row) throw new ArtifactNotFoundError(id);
  return { regenerated: true, artifact: row };
}
