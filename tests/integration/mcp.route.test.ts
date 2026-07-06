import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/mcp/route";

// Route-level tests exercise the Next.js <-> SDK Web-standard transport bridge and
// the open-reads policy over real HTTP semantics (Request in, Response out), which
// the in-memory tool tests don't cover. The write-auth *denial* path is proven with
// the first write tool (post-checkpoint); assertAuthed is unit-tested separately.
const ENDPOINT = "http://localhost/api/mcp";

function rpc(body: unknown, auth = false): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const toolsCall = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("POST /api/mcp", () => {
  it("serves read tools without a bearer token", async () => {
    const res = await POST(rpc(toolsCall("search_artifacts")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { total: number } };
    };
    expect(body.result?.isError).toBeFalsy();
    expect(body.result?.structuredContent?.total).toBe(0);
  });

  it("lists tools over HTTP", async () => {
    const res = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { tools: { name: string }[] } };
    expect(body.result?.tools.map((t) => t.name)).toContain("search_artifacts");
  });

  it("rejects an unsupported MCP-Protocol-Version with 400", async () => {
    const req = rpc(toolsCall("search_artifacts"));
    req.headers.set("mcp-protocol-version", "1999-01-01");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/mcp", () => {
  it("returns 405 (stateless endpoint has no server-push stream)", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
