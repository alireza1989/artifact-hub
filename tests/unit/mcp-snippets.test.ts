import { describe, expect, it } from "vitest";
import {
  buildAuthHeaderSnippet,
  buildDesktopConfigSnippet,
  mcpEndpointUrl,
  TOKEN_PLACEHOLDER,
} from "@/lib/mcp-snippets";

// Phase 6.6 connect panel: the security-relevant behavior is that snippets NEVER
// contain a real token unless one is explicitly passed.

describe("mcp connection snippets", () => {
  it("builds the endpoint URL without duplicate slashes", () => {
    expect(mcpEndpointUrl("https://hub.example.com")).toBe("https://hub.example.com/api/mcp");
    expect(mcpEndpointUrl("https://hub.example.com/")).toBe("https://hub.example.com/api/mcp");
  });

  it("defaults to the placeholder — no token, no leak", () => {
    const snippet = buildDesktopConfigSnippet("https://hub.example.com");
    expect(snippet).toContain(TOKEN_PLACEHOLDER);
    expect(buildAuthHeaderSnippet()).toBe(`Authorization: Bearer ${TOKEN_PLACEHOLDER}`);
  });

  it("embeds the token only when explicitly provided", () => {
    const snippet = buildDesktopConfigSnippet("https://hub.example.com", "sk-team-secret");
    expect(snippet).toContain("Authorization: Bearer sk-team-secret");
    expect(snippet).not.toContain(TOKEN_PLACEHOLDER);
  });

  it("produces valid JSON with the mcp-remote bridge shape", () => {
    const parsed = JSON.parse(buildDesktopConfigSnippet("https://hub.example.com")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const server = parsed.mcpServers["artifact-hub"];
    expect(server?.command).toBe("npx");
    expect(server?.args).toContain("mcp-remote");
    expect(server?.args).toContain("https://hub.example.com/api/mcp");
  });
});
