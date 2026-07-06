import { DomainError } from "@/core/errors";

// Per-request auth context threaded into the tool factory. The route computes
// `isAuthed` from the bearer token (constant-time) before building the server;
// write tools gate on it, read tools ignore it (CLAUDE.md: reads open, writes gated).
export type ToolContext = { isAuthed: boolean };

// Raised by write tools when the caller lacks the team bearer token. The message
// is LLM-recoverable: it says what's missing and exactly how to fix it, and stays
// a tool error (not a transport 401) so read tools keep working on the same client.
export class AuthRequiredError extends DomainError {
  readonly code = "auth_required";
  constructor() {
    super(
      "This operation requires the team bearer token. Add it to your MCP client's " +
        "connector settings (Authorization: Bearer <token>) and retry; browsing, " +
        "reading, and commenting work without it.",
    );
  }
}

export function assertAuthed(ctx: ToolContext): void {
  if (!ctx.isAuthed) throw new AuthRequiredError();
}
