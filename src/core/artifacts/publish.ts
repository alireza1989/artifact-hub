import { suggestMetadata } from "@/core/ai";
import type { AiGeneratedMeta, Artifact } from "@/db/schema";
import { getStorage, type Storage } from "@/lib/storage";
import { type ArtifactSource, MAX_ARTIFACT_BYTES, type PublishMetadata } from "@/lib/validation";
import { createArtifact } from "./create";
import { sniffArtifact } from "./sniff";

export type MetadataField = "title" | "description" | "tags";

export type PublishArtifactInput = {
  bytes: Uint8Array;
  filename?: string;
  declaredContentType?: string;
  source: ArtifactSource;
  metadata?: PublishMetadata;
};

export type PublishArtifactResult = {
  artifact: Artifact;
  // Fields the AI supplied because the caller omitted them (drives MCP `aiFilled`
  // and the UI "suggested" badge). Empty when the caller provided everything or AI
  // did not run / did not produce usable metadata.
  aiFilled: MetadataField[];
};

// Which metadata fields the caller left for AI to fill (PLAN §5.1). Empty tags
// count as omitted.
function missingFields(metadata: PublishMetadata | undefined): MetadataField[] {
  const fields: MetadataField[] = [];
  if (!metadata?.title) fields.push("title");
  if (!metadata?.description) fields.push("description");
  if (!metadata?.tags || metadata.tags.length === 0) fields.push("tags");
  return fields;
}

// The publish entry point for every surface (UI, REST, MCP). Generates metadata
// for omitted fields via Feature A, records the suggestions for audit + the
// "suggested" badge, then creates the artifact. AI never blocks publish: on any
// failure the deterministic filename fallback in createArtifact applies.
export async function publishArtifact(
  input: PublishArtifactInput,
  storage: Storage = getStorage(),
): Promise<PublishArtifactResult> {
  const missing = missingFields(input.metadata);
  const eligible = input.bytes.length > 0 && input.bytes.length <= MAX_ARTIFACT_BYTES;

  let metadata = input.metadata;
  let aiGeneratedMeta: AiGeneratedMeta | null = null;
  let aiFilled: MetadataField[] = [];
  let sniffed = undefined as Awaited<ReturnType<typeof sniffArtifact>> | undefined;

  if (missing.length > 0 && eligible) {
    // Sniff once here so createArtifact can reuse it (single classification).
    sniffed = await sniffArtifact({
      bytes: input.bytes,
      filename: input.filename,
      declaredContentType: input.declaredContentType,
    });
    const suggestion = await suggestMetadata({
      bytes: input.bytes,
      kind: sniffed.kind,
      contentType: sniffed.contentType,
      filename: input.filename,
    });
    if (suggestion.aiGenerated) {
      const next: PublishMetadata = { ...input.metadata };
      const filled: AiGeneratedMeta = {};
      if (missing.includes("title")) {
        next.title = suggestion.title;
        filled.title = suggestion.title;
      }
      if (missing.includes("description")) {
        next.description = suggestion.description;
        filled.description = suggestion.description;
      }
      if (missing.includes("tags")) {
        next.tags = suggestion.tags;
        filled.tags = suggestion.tags;
      }
      metadata = next;
      aiGeneratedMeta = filled;
      aiFilled = missing;
    }
  }

  const artifact = await createArtifact(
    {
      bytes: input.bytes,
      filename: input.filename,
      declaredContentType: input.declaredContentType,
      source: input.source,
      metadata,
      aiGeneratedMeta,
      sniffed,
    },
    storage,
  );

  return { artifact, aiFilled };
}
