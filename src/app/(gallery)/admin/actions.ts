"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { suggestTagMerges } from "@/core/ai";
import { ArtifactNotFoundError, applyTagMerges, deleteArtifact } from "@/core/artifacts";
import { CommentNotFoundError, deleteComment } from "@/core/feedback";
import { revokeShareLink, ShareLinkNotFoundError } from "@/core/sharing";
import { hasValidSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { artifactIdSchema, entityIdSchema, tagMergesSchema } from "@/lib/validation";

// Admin-console mutations (PLAN Phase 6.5). Session-gated before any core call,
// like every other write. Already-gone targets are idempotent successes — the
// admin's goal (the thing no longer exists) is met; anything else is logged and
// rethrown to the error boundary.

export async function adminDeleteArtifactAction(formData: FormData): Promise<void> {
  if (!(await hasValidSession())) redirect("/unlock");
  const id = artifactIdSchema.parse(String(formData.get("id")));
  try {
    await deleteArtifact(id);
  } catch (error) {
    if (!(error instanceof ArtifactNotFoundError)) {
      logger.error({ err: error, action: "admin-delete-artifact", id }, "admin action failed");
      throw error;
    }
  }
  revalidatePath("/admin/artifacts");
  revalidatePath("/");
}

export async function adminRevokeShareLinkAction(formData: FormData): Promise<void> {
  if (!(await hasValidSession())) redirect("/unlock");
  // Boundary validation; a malformed id gets the same idempotent treatment as an
  // unknown one (the goal state — no such active link — already holds).
  const parsed = entityIdSchema.safeParse(String(formData.get("linkId") ?? ""));
  if (!parsed.success) return;
  const linkId = parsed.data;
  try {
    await revokeShareLink(linkId);
  } catch (error) {
    if (!(error instanceof ShareLinkNotFoundError)) {
      logger.error({ err: error, action: "admin-revoke-link", linkId }, "admin action failed");
      throw error;
    }
  }
  revalidatePath("/admin/share-links");
}

export async function adminDeleteCommentAction(formData: FormData): Promise<void> {
  if (!(await hasValidSession())) redirect("/unlock");
  const parsed = entityIdSchema.safeParse(String(formData.get("commentId") ?? ""));
  if (!parsed.success) return;
  const commentId = parsed.data;
  try {
    await deleteComment(commentId);
  } catch (error) {
    if (!(error instanceof CommentNotFoundError)) {
      logger.error(
        { err: error, action: "admin-delete-comment", commentId },
        "admin action failed",
      );
      throw error;
    }
  }
  revalidatePath("/admin/comments");
}

// Tag cleanup (PLAN Phase 6.7). Suggest = AI proposal only, nothing mutates;
// apply = the owner-approved subset, Zod-validated at this boundary, executed by
// the deterministic core function.
export type TagSuggestState = {
  error?: string;
  merges?: { from: string[]; to: string }[];
  none?: boolean;
};

export async function suggestTagMergesAction(
  _prev: TagSuggestState,
  _formData: FormData,
): Promise<TagSuggestState> {
  if (!(await hasValidSession())) return { error: "Your session expired. Unlock again." };
  try {
    const result = await suggestTagMerges();
    if (!result.suggested) {
      return { error: "Couldn't get suggestions right now. Try again in a moment." };
    }
    if (result.merges.length === 0) return { none: true };
    return { merges: result.merges };
  } catch (error) {
    logger.error({ err: error, action: "admin-suggest-tags" }, "admin action failed");
    return { error: "Something went wrong. Please try again." };
  }
}

export type TagApplyState = { error?: string; updated?: number };

export async function applyTagMergesAction(
  _prev: TagApplyState,
  formData: FormData,
): Promise<TagApplyState> {
  if (!(await hasValidSession())) return { error: "Your session expired. Unlock again." };
  let merges: ReturnType<typeof tagMergesSchema.parse>;
  try {
    merges = tagMergesSchema.parse(JSON.parse(String(formData.get("merges") ?? "")));
  } catch {
    return { error: "Select at least one merge to apply." };
  }
  try {
    const { artifactsUpdated } = await applyTagMerges(merges);
    revalidatePath("/admin/tags");
    revalidatePath("/");
    return { updated: artifactsUpdated };
  } catch (error) {
    logger.error({ err: error, action: "admin-apply-tag-merges" }, "admin action failed");
    return { error: "Something went wrong. Please try again." };
  }
}
