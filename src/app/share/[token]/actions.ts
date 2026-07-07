"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { addComment } from "@/core/feedback";
import { verifyShareToken } from "@/core/sharing";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { addCommentInputSchema, shareTokenSchema } from "@/lib/validation";

export type ShareCommentState = { error?: string; ok?: boolean };

// External reviewers may comment without an account. This is the core review loop.
const COMMENTS_PER_WINDOW = 5;
const WINDOW_MS = 60_000;
const CLOSED = "This link is no longer active, so comments are closed.";

export async function submitShareComment(formData: FormData): Promise<ShareCommentState> {
  // Honeypot: a hidden field no human sees. Bots fill it → drop the write but return
  // success so the bot can't distinguish acceptance from rejection.
  if (String(formData.get("website") ?? "").length > 0) return { ok: true };

  const parsedToken = shareTokenSchema.safeParse(String(formData.get("token") ?? ""));
  if (!parsedToken.success) return { error: CLOSED };

  // Re-authorize from the token itself — the artifact id comes from the verified
  // link, never from the client, so a token grants comment-write to exactly one
  // artifact. countAccess:false so posting doesn't double-count the page-view GET.
  const result = await verifyShareToken(parsedToken.data, { countAccess: false });
  if (!result.ok) return { error: CLOSED };

  const fields = addCommentInputSchema.safeParse({
    id: result.artifact.id,
    authorName: String(formData.get("authorName") ?? ""),
    body: String(formData.get("body") ?? ""),
  });
  if (!fields.success) return { error: "Add your name and a comment (up to 5000 characters)." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`share-comment:${ip}:${result.linkId}`, COMMENTS_PER_WINDOW, WINDOW_MS)) {
    return { error: "You’re commenting too fast. Wait a moment and try again." };
  }

  try {
    await addComment({
      artifactId: fields.data.id,
      authorName: fields.data.authorName,
      body: fields.data.body,
    });
  } catch (error) {
    logger.error(
      { err: error, action: "share-comment", linkId: result.linkId },
      "share comment failed",
    );
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath(`/share/${parsedToken.data}`);
  return { ok: true };
}
