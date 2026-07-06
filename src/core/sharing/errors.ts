import { DomainError } from "@/core/errors";

// Recovery text points at the discovery path: get_artifact lists an artifact's
// link ids (create_share_link returns the id too), so an LLM can recover from a
// stale/unknown link id (CLAUDE.md: MCP errors say what to do next).
export class ShareLinkNotFoundError extends DomainError {
  readonly code = "share_link_not_found";
  constructor(id: string) {
    super(
      `Share link "${id}" not found. Call get_artifact(<artifactId>) to list an artifact's ` +
        "active link ids, or create_share_link to make a new one.",
    );
  }
}
