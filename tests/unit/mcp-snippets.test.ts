import { describe, expect, it } from "vitest";
import {
  buildAuthHeaderSnippet,
  buildClaudeCodeCommand,
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
    expect(buildClaudeCodeCommand("https://hub.example.com")).toContain(TOKEN_PLACEHOLDER);
  });

  it("builds the native Claude Code command (no mcp-remote bridge)", () => {
    const cmd = buildClaudeCodeCommand("https://hub.example.com", "sk-team-secret");
    expect(cmd).toBe(
      "claude mcp add --transport http artifact-hub https://hub.example.com/api/mcp " +
        '--header "Authorization: Bearer sk-team-secret"',
    );
    expect(cmd).not.toContain("mcp-remote");
  });

  it("embeds the token only when explicitly provided (via the env map)", () => {
    const snippet = buildDesktopConfigSnippet("https://hub.example.com", "sk-team-secret");
    expect(snippet).toContain("Bearer sk-team-secret");
    expect(snippet).not.toContain(TOKEN_PLACEHOLDER);
  });

  it("uses the Claude-Desktop-safe mcp-remote header pattern", () => {
    const parsed = JSON.parse(buildDesktopConfigSnippet("https://hub.example.com")) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = parsed.mcpServers["artifact-hub"];
    expect(server?.command).toBe("npx");
    expect(server?.args).toContain("mcp-remote");
    expect(server?.args).toContain("https://hub.example.com/api/mcp");
    // No-space header arg + env-var substitution: Claude Desktop passes args
    // verbatim and mishandles spaces; mcp-remote substitutes ${AUTH_HEADER}.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal placeholder mcp-remote consumes.
    expect(server?.args).toContain("Authorization:${AUTH_HEADER}");
    expect(server?.env.AUTH_HEADER).toBe(`Bearer ${TOKEN_PLACEHOLDER}`);
  });
});
