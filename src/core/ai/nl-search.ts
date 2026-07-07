import {
  buildNlSearchInstruction,
  NL_SEARCH_MAX_TOKENS,
  NL_SEARCH_PROMPT_VERSION,
  NL_SEARCH_SYSTEM,
  type NlSearchFilters,
  nlSearchJsonSchema,
  parseNlSearch,
  runFeature,
} from "@/lib/ai";
import type { ListQuery } from "@/lib/validation";
import { type ArtifactListResult, listArtifacts } from "../artifacts/list";

// Feature C (PLAN Phase 6.3): natural-language search. The same search box; a
// Haiku pre-parser maps a conversational query onto the filters listArtifacts
// already supports (FTS terms, kind, tags, since). Invisible by design:
//   - trivial keyword queries bypass the LLM entirely (looksNaturalQuery),
//   - any model failure / budget trip falls back to raw FTS with the original
//     string (runFeature never throws),
//   - a translated search that finds nothing re-runs as raw FTS, so NL search is
//     never WORSE than what the user typed.

// Bypass heuristic: short queries are keyword searches — websearch_to_tsquery
// already handles them well, so don't spend a model call. Natural phrasings are
// almost always ≥4 words ("html mockups from last week") or questions.
const NATURAL_MIN_WORDS = 4;

export function looksNaturalQuery(q: string): boolean {
  if (q.includes("?")) return true;
  return q.trim().split(/\s+/).length >= NATURAL_MIN_WORDS;
}

// Per-instance memo of successful translations. Two jobs (review 2026-07-07):
// pagination consistency — page 2 of a natural search must use the SAME filters
// as page 1, not a fresh (possibly different or failed) translation — and not
// paying for an identical LLM call on every Next click. Successful translations
// only (a transient failure should be retried); bounded FIFO; per serverless
// instance, which is exactly the scope a paginating user session lives in.
const translationMemo = new Map<string, NlSearchFilters>();
const MEMO_MAX = 200;

// Translate one query string via the schema-validated wrapper. Returns null when
// the model produced nothing usable (caller keeps the original query). Exported
// separately so the eval harness can score translation quality without a DB.
export async function translateNlQuery(q: string): Promise<NlSearchFilters | null> {
  const key = q.trim().toLowerCase();
  const cached = translationMemo.get(key);
  if (cached) return cached;

  const result = await runFeature({
    feature: "nl-search",
    promptVersion: NL_SEARCH_PROMPT_VERSION,
    system: NL_SEARCH_SYSTEM,
    content: [{ type: "text", text: buildNlSearchInstruction(q) }],
    jsonSchema: nlSearchJsonSchema,
    parse: parseNlSearch,
    fallback: null,
    maxTokens: NL_SEARCH_MAX_TOKENS,
    artifactId: null,
  });
  if (!result.usedAi || result.value === null) return null;

  if (translationMemo.size >= MEMO_MAX) {
    const oldest = translationMemo.keys().next().value;
    if (oldest !== undefined) translationMemo.delete(oldest);
  }
  translationMemo.set(key, result.value);
  return result.value;
}

// Merge translated filters into the parsed query. Pure and unit-tested. Explicit
// user-chosen filters always win — the AI only fills what the user left open
// (invisible-assist principle: never override a deliberate choice).
export function mergeNlFilters(query: ListQuery, filters: NlSearchFilters): ListQuery {
  return {
    ...query,
    q: filters.terms.length > 0 ? filters.terms : undefined,
    kind: query.kind ?? filters.kind ?? undefined,
    tags: query.tags && query.tags.length > 0 ? query.tags : nonEmpty(filters.tags),
    since:
      query.since ??
      (filters.sinceDays !== null
        ? new Date(Date.now() - filters.sinceDays * 24 * 60 * 60 * 1000)
        : undefined),
  };
}

function nonEmpty(tags: string[]): string[] | undefined {
  return tags.length > 0 ? tags : undefined;
}

function sameSearch(a: ListQuery, b: ListQuery): boolean {
  return (
    a.q === b.q &&
    a.kind === b.kind &&
    a.since?.getTime() === b.since?.getTime() &&
    (a.tags ?? []).join(",") === (b.tags ?? []).join(",")
  );
}

// Drop-in replacement for listArtifacts wherever a human-typed query arrives
// (gallery search box; MCP search_artifacts opt-in). Structured-only queries and
// keyword queries hit the index directly, exactly as before.
export async function searchArtifactsNaturally(query: ListQuery): Promise<ArtifactListResult> {
  if (!query.q || !looksNaturalQuery(query.q)) return listArtifacts(query);

  const filters = await translateNlQuery(query.q);
  if (filters === null) return listArtifacts(query);

  const merged = mergeNlFilters(query, filters);
  if (sameSearch(merged, query)) return listArtifacts(query);

  const result = await listArtifacts(merged);
  // Never worse than raw FTS: an over-narrowed translation that matches nothing
  // silently retries the user's original words.
  if (result.total === 0) return listArtifacts(query);
  return result;
}
