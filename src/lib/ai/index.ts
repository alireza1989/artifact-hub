// lib/ai — the single entry point for LLM calls (PLAN §5): a wrapper that enforces
// budget, schema validation, retry, deterministic fallback, and telemetry, plus a
// versioned prompt registry. core/ai composes these; nothing else calls the model.

export { type RunFeatureInput, type RunFeatureResult, runFeature } from "./client";
export { AI_FEATURE_MODELS, AI_MODEL, type AiFeature } from "./config";
export {
  type ModelCaller,
  type ModelCallInput,
  type ModelCallResult,
  resetModelCaller,
  setModelCallerForTesting,
} from "./model";
export { computeCostUsd } from "./pricing";
export {
  buildSynthesisInstruction,
  parseSynthesis,
  SYNTHESIS_MAX_TOKENS,
  SYNTHESIS_PROMPT_VERSION,
  SYNTHESIS_SYSTEM,
  type SynthesisComment,
  synthesisJsonSchema,
} from "./prompts/feedback-synthesis.v1";
export {
  buildImageInstruction,
  buildTextInstruction,
  METADATA_MAX_TOKENS,
  METADATA_PROMPT_VERSION,
  METADATA_SYSTEM,
  type MetadataSuggestion,
  metadataJsonSchema,
  parseMetadata,
} from "./prompts/metadata-gen.v1";
export {
  buildNlSearchInstruction,
  NL_SEARCH_MAX_TOKENS,
  NL_SEARCH_PROMPT_VERSION,
  NL_SEARCH_SYSTEM,
  type NlSearchFilters,
  nlSearchJsonSchema,
  parseNlSearch,
} from "./prompts/nl-search.v1";
export { BUDGET_EXCEEDED_ERROR, type LlmOutcome } from "./telemetry";
