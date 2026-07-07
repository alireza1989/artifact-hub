// Copy-paste-ready MCP connection snippets (PLAN Phase 6.6), mirroring README
// §"Connect from an MCP client". Pure string builders so the token-placeholder
// behavior is unit-testable: the real token appears ONLY when explicitly passed
// (the /connect page passes it only for an unlocked owner who clicked reveal).

export const TOKEN_PLACEHOLDER = "<YOUR_TEAM_TOKEN>";

export function mcpEndpointUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

// claude_desktop_config.json for stdio-only clients, bridged via mcp-remote.
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
            `Authorization: Bearer ${token ?? TOKEN_PLACEHOLDER}`,
          ],
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
