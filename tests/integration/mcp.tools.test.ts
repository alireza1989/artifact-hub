import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createArtifact } from "@/core/artifacts";
import { buildServer } from "@/mcp";

// Tool-level tests drive the real MCP protocol through the SDK's in-memory linked
// transport (Client <-> McpServer) — full schema-validation + dispatch fidelity,
// no HTTP server. Backed by the real Postgres test DB + injected storage fake
// (tests/integration/setup.ts).
async function connect(isAuthed = true) {
  const server = buildServer({ isAuthed });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function seed(title: string): Promise<void> {
  await createArtifact({
    bytes: new TextEncoder().encode("<!doctype html><html></html>"),
    filename: `${title}.html`,
    source: "mcp",
    metadata: { title },
  });
}

describe("MCP server — handshake & tool listing", () => {
  it("surfaces cross-tool instructions and lists search_artifacts", async () => {
    const { client, close } = await connect();
    try {
      expect(client.getInstructions()).toContain("Artifact Hub");

      const { tools } = await client.listTools();
      const search = tools.find((t) => t.name === "search_artifacts");
      expect(search).toBeDefined();
      expect(search?.description ?? "").toMatch(/never guess an id/i);
      expect(search?.inputSchema).toBeDefined();
      expect(search?.outputSchema).toBeDefined();
    } finally {
      await close();
    }
  });
});

describe("search_artifacts tool", () => {
  it("returns relevance-ranked matches (happy path)", async () => {
    await seed("Roadmap deck");
    await seed("Budget sheet");

    const { client, close } = await connect();
    try {
      const res = await client.callTool({ name: "search_artifacts", arguments: { q: "roadmap" } });
      expect(res.isError).toBeFalsy();
      const structured = res.structuredContent as {
        total: number;
        items: { title: string }[];
      };
      expect(structured.total).toBe(1);
      expect(structured.items[0]?.title).toBe("Roadmap deck");
    } finally {
      await close();
    }
  });

  it("returns an empty result (not an error) when nothing matches", async () => {
    const { client, close } = await connect();
    try {
      const res = await client.callTool({
        name: "search_artifacts",
        arguments: { q: "nothingherematchesthisquery" },
      });
      expect(res.isError).toBeFalsy();
      expect((res.structuredContent as { total: number }).total).toBe(0);
    } finally {
      await close();
    }
  });

  it("returns a recoverable validation error for an invalid kind (failure path)", async () => {
    const { client, close } = await connect();
    try {
      const res = await client.callTool({
        name: "search_artifacts",
        arguments: { kind: "not-a-kind" },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
      expect(text).toMatch(/html/); // names the valid options so the model can retry
    } finally {
      await close();
    }
  });
});
