import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isAuthorized } from "@/lib/http/auth";
import { buildServer } from "@/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MCP endpoint (PLAN §4): Streamable HTTP in stateless mode — a fresh McpServer +
// transport per request (`sessionIdGenerator: undefined`), so concurrent clients
// are fully isolated and nothing is retained between requests (serverless-friendly).
// 1.29.0's Web-standard transport speaks the Fetch API directly, so the App Router
// Request/Response is passed through with no Node req/res bridging.
//
// Auth: the bearer token is verified once here (constant-time) BEFORE the server is
// built or any core call runs; `isAuthed` is threaded to the tools, where write
// tools gate on it and reads stay open (CLAUDE.md security invariants).
export async function POST(req: Request): Promise<Response> {
  const server = buildServer({ isAuthed: isAuthorized(req) });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Return a single JSON response instead of an SSE stream: our tools are
    // request/response, and buffered JSON avoids serverless streaming pitfalls.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

// Stateless server: there is no server-initiated SSE stream to open, so GET has
// nothing to serve. The spec permits 405 here.
export function GET(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method Not Allowed: this MCP endpoint is stateless; send JSON-RPC via POST.",
      },
      id: null,
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
