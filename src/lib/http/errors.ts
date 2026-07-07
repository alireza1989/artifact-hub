import { NextResponse } from "next/server";
import { z } from "zod";
import { ArtifactNotFoundError, EmptyContentError, FileTooLargeError } from "@/core/artifacts";
import { logger } from "@/lib/logger";

// Adapter-layer error for malformed requests (bad multipart, missing file, etc.).
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Uniform API error envelope (PLAN §6 Runtime): { error: { code, message } }.
export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function unauthorized(): NextResponse {
  return apiError(401, "unauthorized", "Missing or invalid bearer token.");
}

// Map a thrown error to a response. Domain + validation errors become 4xx with a
// stable code; anything unexpected is logged and returned as an opaque 500.
// `context` (route name, ids — never content, tokens, or user text) rides along
// on the log line so a 500 in prod is attributable without reproduction.
export function toErrorResponse(
  error: unknown,
  context?: Record<string, string | undefined>,
): NextResponse {
  if (error instanceof HttpError) return apiError(error.status, error.code, error.message);
  if (error instanceof ArtifactNotFoundError) return apiError(404, error.code, error.message);
  if (error instanceof FileTooLargeError) return apiError(413, error.code, error.message);
  if (error instanceof EmptyContentError) return apiError(400, error.code, error.message);
  if (error instanceof z.ZodError) {
    return apiError(400, "invalid_request", z.prettifyError(error));
  }
  logger.error({ err: error, ...context }, "unhandled API error");
  return apiError(500, "internal_error", "Something went wrong. Please try again.");
}
