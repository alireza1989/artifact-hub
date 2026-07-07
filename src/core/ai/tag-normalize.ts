import {
  buildTagNormalizeInstruction,
  parseTagNormalize,
  runFeature,
  TAG_NORMALIZE_MAX_TOKENS,
  TAG_NORMALIZE_PROMPT_VERSION,
  TAG_NORMALIZE_SYSTEM,
  type TagMergeSuggestion,
  tagNormalizeJsonSchema,
} from "@/lib/ai";
import { listTagUsage, type TagUsage } from "../artifacts/tags";

// Feature D (PLAN Phase 6.7): owner-triggered tag cleanup. The model only ever
// PROPOSES merge groups over the vocabulary it was shown; nothing mutates until
// the owner approves and the deterministic applyTagMerges runs. Invisible-assist
// rules as always: budget-capped, schema-validated, telemetry row per call, and
// any failure degrades to "no suggestions" — never an error in the owner's face.

export type TagMergeSuggestions =
  | { suggested: true; merges: TagMergeSuggestion[]; vocabularySize: number }
  | { suggested: false; vocabularySize: number };

const MIN_TAGS_FOR_CLEANUP = 2;

export async function suggestTagMerges(usage?: TagUsage[]): Promise<TagMergeSuggestions> {
  const vocabulary = usage ?? (await listTagUsage());
  if (vocabulary.length < MIN_TAGS_FOR_CLEANUP) {
    return { suggested: false, vocabularySize: vocabulary.length };
  }
  const known = new Set(vocabulary.map((u) => u.tag));

  const result = await runFeature<TagMergeSuggestion[]>({
    feature: "tag-normalize",
    promptVersion: TAG_NORMALIZE_PROMPT_VERSION,
    system: TAG_NORMALIZE_SYSTEM,
    content: [{ type: "text", text: buildTagNormalizeInstruction(vocabulary) }],
    jsonSchema: tagNormalizeJsonSchema,
    parse: (text) => parseTagNormalize(text, known),
    fallback: [],
    maxTokens: TAG_NORMALIZE_MAX_TOKENS,
    artifactId: null,
  });

  if (!result.usedAi) return { suggested: false, vocabularySize: vocabulary.length };
  return { suggested: true, merges: result.value, vocabularySize: vocabulary.length };
}
