// Copy-paste-ready MCP connection snippets (PLAN Phase 6.6), mirroring README
// §"Connect from an MCP client". Pure string builders so the token-placeholder
// behavior is unit-testable: the real token appears ONLY when explicitly passed
// (the /connect page passes it only for an unlocked owner who clicked reveal).

export const TOKEN_PLACEHOLDER = "<YOUR_TEAM_TOKEN>";

export function mcpEndpointUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

// claude_desktop_config.json for stdio-only clients, bridged via mcp-remote.
// The header value goes through an env var and `Authorization:${AUTH_HEADER}`
// carries NO space after the colon — Claude Desktop passes args verbatim (no
// ${} interpolation of its own, plus a known bug with spaces inside args);
// mcp-remote substitutes ${AUTH_HEADER} from `env` itself. This is the pattern
// mcp-remote documents for exactly this situation.
export function buildDesktopConfigSnippet(baseUrl: string, token?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "artifact-hub": {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            mcpEndpointUrl(baseUrl),
            "--header",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal on purpose — mcp-remote (not JS) substitutes ${AUTH_HEADER} from `env` at runtime.
            "Authorization:${AUTH_HEADER}",
          ],
          env: { AUTH_HEADER: `Bearer ${token ?? TOKEN_PLACEHOLDER}` },
        },
      },
    },
    null,
    2,
  );
}

export function buildAuthHeaderSnippet(token?: string): string {
  return `Authorization: Bearer ${token ?? TOKEN_PLACEHOLDER}`;
}

// Claude Code speaks Streamable HTTP natively (no mcp-remote bridge): one CLI
// command registers the server, headers included.
export function buildClaudeCodeCommand(baseUrl: string, token?: string): string {
  return (
    `claude mcp add --transport http artifact-hub ${mcpEndpointUrl(baseUrl)} ` +
    `--header "Authorization: Bearer ${token ?? TOKEN_PLACEHOLDER}"`
  );
}
