import type Anthropic from "@anthropic-ai/sdk";
import {
  buildImageInstruction,
  buildTextInstruction,
  METADATA_MAX_TOKENS,
  METADATA_PROMPT_VERSION,
  METADATA_SYSTEM,
  metadataJsonSchema,
  parseMetadata,
  runFeature,
} from "@/lib/ai";
import { kindLabel } from "@/lib/format";
import type { ArtifactKind } from "@/lib/validation";
import { extractForMetadata } from "./extract";

export type SuggestMetadataInput = {
  bytes: Uint8Array;
  kind: ArtifactKind;
  contentType: string;
  filename?: string;
};

// Either an AI-generated suggestion (used only when the model succeeded) or a
// signal that publish should keep its deterministic filename fallback. Never
// throws — Feature A must never block publish (PLAN §5.1).
export type SuggestMetadataResult =
  | { aiGenerated: true; title: string; description: string; tags: string[] }
  | { aiGenerated: false };

// Feature A (PLAN §5.1): extract the artifact's signal, ask Haiku for
// {title, description, tags} via the schema-validated wrapper, and report whether
// the model actually produced usable metadata.
export async function suggestMetadata(input: SuggestMetadataInput): Promise<SuggestMetadataResult> {
  const extract = await extractForMetadata(input);
  if (extract.mode === "none") return { aiGenerated: false };

  const content: Anthropic.ContentBlockParam[] =
    extract.mode === "image"
      ? [
          { type: "text", text: buildImageInstruction(input.filename) },
          {
            type: "image",
            source: { type: "base64", media_type: extract.mediaType, data: extract.base64 },
          },
        ]
      : [
          {
            type: "text",
            text: buildTextInstruction(kindLabel(input.kind), input.filename, extract.text),
          },
        ];

  const result = await runFeature({
    feature: "metadata-gen",
    promptVersion: METADATA_PROMPT_VERSION,
    system: METADATA_SYSTEM,
    content,
    jsonSchema: metadataJsonSchema,
    parse: parseMetadata,
    // Sentinel fallback; discarded when usedAi is false.
    fallback: { title: "", description: "", tags: [] },
    maxTokens: METADATA_MAX_TOKENS,
    artifactId: null,
  });

  if (!result.usedAi) return { aiGenerated: false };
  return {
    aiGenerated: true,
    title: result.value.title,
    description: result.value.description,
    tags: result.value.tags,
  };
}
