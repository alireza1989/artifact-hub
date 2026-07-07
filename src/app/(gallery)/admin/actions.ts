"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ArtifactNotFoundError, deleteArtifact } from "@/core/artifacts";
import { CommentNotFoundError, deleteComment } from "@/core/feedback";
import { revokeShareLink, ShareLinkNotFoundError } from "@/core/sharing";
import { hasValidSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { artifactIdSchema } from "@/lib/validation";

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
  const linkId = String(formData.get("linkId") ?? "");
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
  const commentId = String(formData.get("commentId") ?? "");
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
