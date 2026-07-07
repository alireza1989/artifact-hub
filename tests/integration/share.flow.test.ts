import { describe, expect, it, vi } from "vitest";

// The Phase-3 share flow lives in Server Actions, which reach for Next's request-
// scoped glue (headers/cache/navigation) and the session cookie. Mock only that
// framework glue — the actual auth/verify/write logic runs against the real test DB.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  // Random IP per call so the in-memory rate limiter never bleeds across tests.
  headers: async () =>
    new Headers({ "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.1` }),
}));
vi.mock("@/lib/auth/session", () => ({ hasValidSession: async () => true }));

import { createShareLinkAction, revokeShareLinkAction } from "@/app/(gallery)/actions";
import { submitShareComment } from "@/app/share/[token]/actions";
import { createArtifact } from "@/core/artifacts";
import { listComments } from "@/core/feedback";
import { createShareLink, listShareLinks, revokeShareLink, verifyShareToken } from "@/core/sharing";

async function seedArtifact(): Promise<string> {
  const a = await createArtifact({
    bytes: new TextEncoder().encode("<!doctype html><html><h1>hi</h1></html>"),
    filename: "x.html",
    source: "web",
    metadata: { title: "Shareable" },
  });
  return a.id;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("submitShareComment (external review loop)", () => {
  it("writes a comment on the token's artifact without counting an extra view", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");
    await verifyShareToken(link.token); // the page GET — the one legitimate view

    const res = await submitShareComment(
      form({ token: link.token, authorName: "External Reviewer", body: "Looks great!" }),
    );

    expect(res.ok).toBe(true);
    const comments = await listComments(id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.authorName).toBe("External Reviewer");
    // Commenting re-verified the token with countAccess:false, so the view count is
    // still just the single page GET.
    const [summary] = await listShareLinks(id);
    expect(summary?.accessCount).toBe(1);
  });

  it("binds the comment to exactly the token's artifact, not another", async () => {
    const [a, b] = [await seedArtifact(), await seedArtifact()];
    const linkA = await createShareLink(a, "24h");

    await submitShareComment(form({ token: linkA.token, authorName: "R", body: "for A only" }));

    expect(await listComments(a)).toHaveLength(1);
    expect(await listComments(b)).toHaveLength(0);
  });

  it("silently drops a honeypot submission", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");

    const res = await submitShareComment(
      form({ token: link.token, authorName: "Bot", body: "spam", website: "http://spam.example" }),
    );

    expect(res.ok).toBe(true); // bot can't tell it was caught
    expect(await listComments(id)).toHaveLength(0); // …but nothing was written
  });

  it("refuses comments on a revoked link", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");
    await revokeShareLink(link.linkId);

    const res = await submitShareComment(form({ token: link.token, authorName: "X", body: "y" }));

    expect(res.error).toBeTruthy();
    expect(await listComments(id)).toHaveLength(0);
  });

  it("rejects a malformed token before any DB write", async () => {
    const res = await submitShareComment(
      form({ token: "not-a-token", authorName: "X", body: "y" }),
    );
    expect(res.error).toBeTruthy();
  });

  it("rejects an empty comment body", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");
    const res = await submitShareComment(form({ token: link.token, authorName: "X", body: "   " }));
    expect(res.error).toBeTruthy();
    expect(await listComments(id)).toHaveLength(0);
  });
});

describe("owner share-link actions", () => {
  it("creates a link and returns its one-time URL + human expiry", async () => {
    const id = await seedArtifact();
    const state = await createShareLinkAction({}, form({ id, duration: "72h" }));

    expect(state.error).toBeUndefined();
    expect(state.url).toContain("/share/");
    expect(state.expiresInHuman).toBe("3 days");
    expect(await listShareLinks(id)).toHaveLength(1);
  });

  it("revokes a link so it no longer resolves", async () => {
    const id = await seedArtifact();
    const link = await createShareLink(id, "24h");

    await revokeShareLinkAction(form({ linkId: link.linkId, artifactId: id }));

    expect(await verifyShareToken(link.token)).toMatchObject({ ok: false, reason: "revoked" });
  });

  it("surfaces a friendly error for an unknown artifact", async () => {
    const state = await createShareLinkAction({}, form({ id: "nope", duration: "24h" }));
    expect(state.error).toBeTruthy();
    expect(state.url).toBeUndefined();
  });
});
