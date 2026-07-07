// core/ai — LLM features: metadata generation (Feature A) and feedback synthesis
// (Feature B), plus observability read models (PLAN Phase 4, §5). Composes the
// lib/ai wrapper; framework-free and unit-testable with the model mocked.
export { extractForMetadata, headTailSample, type MetadataExtract } from "./extract";
export {
  type SuggestMetadataInput,
  type SuggestMetadataResult,
  suggestMetadata,
} from "./metadata";
export {
  type AiFailure,
  type AiWindowStats,
  getAiWindowStats,
  getRecentAiFailures,
} from "./observability";
export { getOrCreateSynthesis, synthesizeComments } from "./synthesis";
