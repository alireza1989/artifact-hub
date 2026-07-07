import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";

// The single low-level Claude call. Everything above it (budget, schema
// validation, retry, fallback, telemetry) lives in client.ts; this file is the
// only place that talks to the Anthropic SDK. Tests inject a fake caller here so
// the whole wrapper runs deterministically without spending tokens — the "mock at
// the wrapper boundary" the Phase 4 tests require.

export type ModelCallInput = {
  model: string;
  system: string;
  // User content blocks: a fenced text block for text kinds, or a text prompt +
  // image block for the vision path (Feature A, image kind).
  content: Anthropic.ContentBlockParam[];
  // Loose JSON schema handed to structured outputs (types + enums only; length
  // caps are enforced by the feature's Zod parser, not here — see PLAN §5.3).
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
};

export type ModelCallResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export type ModelCaller = (input: ModelCallInput) => Promise<ModelCallResult>;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  // Lazy so importing this module never requires the key; the real client is only
  // built when a real call is made (never in tests, which inject a fake caller).
  if (!client) client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  return client;
}

const realCaller: ModelCaller = async (input) => {
  // Structured outputs constrains the response to the JSON schema. No `effort`
  // (Haiku 4.5 rejects it) and no `thinking` — these are short extraction tasks.
  const message = await getClient().messages.create({
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    output_config: { format: { type: "json_schema", schema: input.jsonSchema } },
    messages: [{ role: "user", content: input.content }],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    stopReason: message.stop_reason,
  };
};

let caller: ModelCaller = realCaller;

export function callModel(input: ModelCallInput): Promise<ModelCallResult> {
  return caller(input);
}

// Test seam mirroring lib/storage's setStorageForTesting: swap the low-level
// caller so the wrapper's guardrails run for real against canned model output.
export function setModelCallerForTesting(fn: ModelCaller): void {
  caller = fn;
}

export function resetModelCaller(): void {
  caller = realCaller;
}
