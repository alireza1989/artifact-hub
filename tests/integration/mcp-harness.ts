import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createArtifact } from "@/core/artifacts";
import { buildServer } from "@/mcp";

// Shared in-memory MCP harness for tool integration tests (not a test file itself —
// no `.test.ts`, so vitest won't collect it). Drives the real protocol through the
// SDK's linked transports against the Postgres test DB + injected storage fake.
export async function connect(isAuthed = true): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
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

export async function seedArtifact(
  title = "Seed",
  html = "<!doctype html><html><body>hi</body></html>",
): Promise<string> {
  const a = await createArtifact({
    bytes: new TextEncoder().encode(html),
    filename: `${title}.html`,
    source: "mcp",
    metadata: { title },
  });
  return a.id;
}

// Accepts the loose CallTool result union the client returns (content vs. legacy
// toolResult branch) and pulls the first text block for assertions.
export function errorText(res: unknown): string {
  const content = (res as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return (content[0] as { text?: string })?.text ?? "";
}
