import { describe, expect, it } from "vitest";
import { connect, errorText, seedArtifact } from "./mcp-harness";

// publish_artifact, create_share_link, revoke_share_link — the bearer-gated writes.
// Every tool: happy path + the auth-denial path + a domain failure.

describe("publish_artifact", () => {
  it("publishes inline content when authenticated", async () => {
    const { client, close } = await connect(true);
    try {
      const res = await client.callTool({
        name: "publish_artifact",
        arguments: {
          content: "<!doctype html><html></html>",
          filename: "home.html",
          title: "Home",
        },
      });
      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent as { kind: string; title: string; aiFilled: string[] };
      expect(sc.kind).toBe("html");
      expect(sc.title).toBe("Home");
      expect(sc.aiFilled).toEqual([]); // AI fill is Phase 4
    } finally {
      await close();
    }
  });

  it("DENIES publishing without the bearer token (recoverable)", async () => {
    const { client, close } = await connect(false);
    try {
      const res = await client.callTool({
        name: "publish_artifact",
        arguments: { content: "<html></html>", title: "Nope" },
      });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/bearer token/i);
    } finally {
      await close();
    }
  });

  it("rejects more than one content source", async () => {
    const { client, close } = await connect(true);
    try {
      const res = await client.callTool({
        name: "publish_artifact",
        arguments: { content: "<html></html>", contentBase64: "aGk=" },
      });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/exactly one/i);
    } finally {
      await close();
    }
  });

  it("rejects an oversized base64 payload with a pointer to sourceUrl", async () => {
    const { client, close } = await connect(true);
    try {
      const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64");
      const res = await client.callTool({
        name: "publish_artifact",
        arguments: { contentBase64: big, filename: "big.bin" },
      });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/sourceUrl/);
    } finally {
      await close();
    }
  });
});

describe("create_share_link + revoke_share_link", () => {
  it("creates a link, exposes it via get_artifact, then revokes it", async () => {
    const id = await seedArtifact("Shareable");
    const { client, close } = await connect(true);
    try {
      const created = await client.callTool({
        name: "create_share_link",
        arguments: { id, duration: "72h" },
      });
      expect(created.isError).toBeFalsy();
      const link = created.structuredContent as {
        linkId: string;
        url: string;
        expiresInHuman: string;
      };
      expect(link.url).toContain("/share/");
      expect(link.expiresInHuman).toBe("3 days");

      const got = await client.callTool({ name: "get_artifact", arguments: { id } });
      const links = (got.structuredContent as { shareLinks: { id: string }[] }).shareLinks;
      expect(links.map((l) => l.id)).toContain(link.linkId);

      const revoked = await client.callTool({
        name: "revoke_share_link",
        arguments: { linkId: link.linkId },
      });
      expect((revoked.structuredContent as { alreadyInactive: boolean }).alreadyInactive).toBe(
        false,
      );
    } finally {
      await close();
    }
  });

  it("DENIES create_share_link without the bearer token", async () => {
    const id = await seedArtifact("Locked");
    const { client, close } = await connect(false);
    try {
      const res = await client.callTool({
        name: "create_share_link",
        arguments: { id, duration: "24h" },
      });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/bearer token/i);
    } finally {
      await close();
    }
  });

  it("returns a recovery-pathed error revoking an unknown link id", async () => {
    const { client, close } = await connect(true);
    try {
      const res = await client.callTool({
        name: "revoke_share_link",
        arguments: { linkId: "ghost" },
      });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toMatch(/get_artifact/);
    } finally {
      await close();
    }
  });
});
