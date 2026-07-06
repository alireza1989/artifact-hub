import { describe, expect, it } from "vitest";
import { createArtifact } from "@/core/artifacts";
import {
  createShareLink,
  hashToken,
  listShareLinks,
  parseToken,
  revokeShareLink,
  ShareLinkNotFoundError,
  signToken,
  verifyShareToken,
  verifySignature,
} from "@/core/sharing";
import { getDb } from "@/db";
import { shareLinks } from "@/db/schema";

async function seedArtifact(): Promise<string> {
  const a = await createArtifact({
    bytes: new TextEncoder().encode("<!doctype html><html></html>"),
    filename: "x.html",
    source: "mcp",
    metadata: { title: "Shareable" },
  });
  return a.id;
}

describe("share token crypto", () => {
  it("signs, parses, and verifies with constant-time expiry binding", () => {
    const linkId = "abc123";
    const expiresAt = Date.now() + 10_000;
    const token = signToken(linkId, expiresAt);
    const parsed = parseToken(token);

    expect(parsed?.linkId).toBe(linkId);
    expect(verifySignature(linkId, expiresAt, parsed?.signature ?? "")).toBe(true);
    // signature is bound to the expiry and to the exact bytes:
    expect(verifySignature(linkId, expiresAt + 1, parsed?.signature ?? "")).toBe(false);
    expect(verifySignature(linkId, expiresAt, `${parsed?.signature}x`)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(parseToken("nodot")).toBeNull();
    expect(parseToken(".sig")).toBeNull();
    expect(parseToken("id.")).toBeNull();
  });
});

describe("createShareLink / verifyShareToken", () => {
  it("creates a link that resolves to its artifact and counts access", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "72h");
    expect(link.url).toContain(`/share/${link.token}`);
    expect(link.expiresInHuman).toBe("3 days");

    const res = await verifyShareToken(link.token);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.artifact.id).toBe(id);

    const [summary] = await listShareLinks(id);
    expect(summary?.accessCount).toBe(1); // verify incremented it
  });

  it("returns invalid for an unknown/forged token", async () => {
    const res = await verifyShareToken("bogus.signature");
    expect(res).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("returns expired for a past-expiry link", async () => {
    const id = await seedArtifact();
    const linkId = "expiredlink";
    const past = Date.now() - 1000;
    const token = signToken(linkId, past);
    await getDb()
      .insert(shareLinks)
      .values({
        id: linkId,
        artifactId: id,
        tokenHash: hashToken(token),
        expiresAt: new Date(past),
      });

    expect(await verifyShareToken(token)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects unknown artifact ids at creation", async () => {
    await expect(createShareLink("nope", "24h")).rejects.toThrow(/not found/i);
  });
});

describe("revokeShareLink", () => {
  it("revokes a link so it no longer resolves, and is idempotent", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");

    const first = await revokeShareLink(link.linkId);
    expect(first.alreadyInactive).toBe(false);
    expect(await verifyShareToken(link.token)).toMatchObject({ ok: false, reason: "revoked" });

    const second = await revokeShareLink(link.linkId);
    expect(second.alreadyInactive).toBe(true);
    expect(second.revokedAt.getTime()).toBe(first.revokedAt.getTime());
  });

  it("throws ShareLinkNotFoundError for an unknown link id", async () => {
    await expect(revokeShareLink("no-such-link")).rejects.toBeInstanceOf(ShareLinkNotFoundError);
  });
});
