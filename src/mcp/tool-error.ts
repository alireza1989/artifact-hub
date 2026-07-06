import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DomainError } from "@/core/errors";
import { logger } from "@/lib/logger";

// Map a thrown error to an MCP tool error result. Mirrors the HTTP adapter's
// toErrorResponse (src/lib/http/errors.ts): domain + validation errors surface
// their (recovery-bearing) message to the model; anything unexpected is logged
// and returned as an opaque, retry-able message. `isError: true` marks the result
// as a tool failure the client/model can react to (CLAUDE.md: MCP errors are
// LLM-recoverable — say what went wrong and what to do next).
export function toToolError(error: unknown): CallToolResult {
  if (error instanceof DomainError) return textError(error.message);
  if (error instanceof z.ZodError) return textError(z.prettifyError(error));
  logger.error({ err: error }, "unhandled MCP tool error");
  return textError("Something went wrong handling this request. Please try again.");
}

function textError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
