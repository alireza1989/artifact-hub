// Central model id for all LLM features (PLAN §5). Never hardcode a model id
// elsewhere — reference these constants so a model bump is a one-line change.
export const AI_MODEL = "claude-haiku-4-5-20251001";

export const AI_FEATURE_MODELS = {
  "metadata-gen": AI_MODEL,
  "feedback-synthesis": AI_MODEL,
  "nl-search": AI_MODEL,
  "tag-normalize": AI_MODEL,
} as const;

export type AiFeature = keyof typeof AI_FEATURE_MODELS;
