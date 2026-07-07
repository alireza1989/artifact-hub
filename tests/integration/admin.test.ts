// Admin console (PLAN Phase 6.5): platform-wide share-link inventory, comment
// moderation, artifact deletion — core queries + the session-gated server
// actions (happy path + auth-denial per action). Request-scoped Next glue is
// mocked like share.flow.test.ts; the session mock is flippable per test.
const sessionState = { valid: true };
const redirects: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirects.push(path);
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  hasValidSession: async () => sessionState.valid,
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminDeleteArtifactAction,
  adminDeleteCommentAction,
  adminRevokeShareLinkAction,
} from "@/app/(gallery)/admin/actions";
import { ArtifactNotFoundError, createArtifact, getArtifact } from "@/core/artifacts";
import {
  addComment,
  CommentNotFoundError,
  deleteComment,
  listComments,
  listRecentComments,
} from "@/core/feedback";
import { createShareLink, listAllShareLinks, listShareLinks } from "@/core/sharing";

const enc = (s: string) => new TextEncoder().encode(s);

async function seed(title: string) {
  return createArtifact({
    bytes: enc(`# ${title}`),
    filename: `${title}.md`,
    source: "api",
    metadata: { title },
  });
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  sessionState.valid = true;
  redirects.length = 0;
});

describe("core listAllShareLinks (platform-wide)", () => {
  it("returns links across all artifacts, newest first, with artifact titles", async () => {
    const a = await seed("Alpha");
    const b = await seed("Beta");
    await createShareLink(a.id, "24h");
    const later = await createShareLink(b.id, "7d");

    const page = await listAllShareLinks();
    expect(page.total).toBe(2);
    expect(page.items[0]?.id).toBe(later.linkId); // newest first
    expect(page.items.map((l) => l.artifactTitle).sort()).toEqual(["Alpha", "Beta"]);
    expect(page.items[0]?.accessCount).toBe(0);
  });

  it("paginates with a true total", async () => {
    const a = await seed("Gamma");
    await createShareLink(a.id, "24h");
    await createShareLink(a.id, "24h");
    await createShareLink(a.id, "24h");
    const page = await listAllShareLinks({ limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });
});

describe("core comment moderation", () => {
  it("lists recent comments across artifacts with context, newest first", async () => {
    const a = await seed("Doc A");
    const b = await seed("Doc B");
    await addComment({ artifactId: a.id, authorName: "R1", body: "first" });
    await addComment({ artifactId: b.id, authorName: "R2", body: "second" });

    const page = await listRecentComments();
    expect(page.total).toBe(2);
    expect(page.items[0]?.body).toBe("second");
    expect(page.items[0]?.artifactTitle).toBe("Doc B");
    expect(page.items[1]?.artifactTitle).toBe("Doc A");
  });

  it("deletes a comment; deleting again raises the domain error", async () => {
    const a = await seed("Doc C");
    const created = await addComment({ artifactId: a.id, authorName: "S", body: "spam" });
    await deleteComment(created.id);
    expect(await listComments(a.id)).toHaveLength(0);
    await expect(deleteComment(created.id)).rejects.toBeInstanceOf(CommentNotFoundError);
  });
});

describe("admin server actions", () => {
  it("deletes an artifact when authed (idempotent on already-gone)", async () => {
    const a = await seed("Deletable");
    await adminDeleteArtifactAction(form({ id: a.id }));
    await expect(getArtifact(a.id)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    // Second call: already gone → idempotent success, no throw.
    await adminDeleteArtifactAction(form({ id: a.id }));
  });

  it("revokes a share link when authed", async () => {
    const a = await seed("Linked");
    const link = await createShareLink(a.id, "24h");
    await adminRevokeShareLinkAction(form({ linkId: link.linkId }));
    const [row] = await listShareLinks(a.id);
    expect(row?.revokedAt).not.toBeNull();
  });

  it("deletes a comment when authed", async () => {
    const a = await seed("Commented");
    const created = await addComment({ artifactId: a.id, authorName: "S", body: "spam" });
    await adminDeleteCommentAction(form({ commentId: created.id }));
    expect(await listComments(a.id)).toHaveLength(0);
  });

  it("denies every action without a session (redirects to /unlock, no writes)", async () => {
    const a = await seed("Protected");
    const link = await createShareLink(a.id, "24h");
    const created = await addComment({ artifactId: a.id, authorName: "R", body: "keep me" });

    sessionState.valid = false;
    await expect(adminDeleteArtifactAction(form({ id: a.id }))).rejects.toThrow("REDIRECT");
    await expect(adminRevokeShareLinkAction(form({ linkId: link.linkId }))).rejects.toThrow(
      "REDIRECT",
    );
    await expect(adminDeleteCommentAction(form({ commentId: created.id }))).rejects.toThrow(
      "REDIRECT",
    );
    expect(redirects).toEqual(["/unlock", "/unlock", "/unlock"]);

    sessionState.valid = true;
    expect(await getArtifact(a.id)).toBeTruthy();
    const [row] = await listShareLinks(a.id);
    expect(row?.revokedAt).toBeNull();
    expect(await listComments(a.id)).toHaveLength(1);
  });
});
