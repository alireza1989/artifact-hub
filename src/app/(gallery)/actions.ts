"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ArtifactNotFoundError, createArtifact, deleteArtifact } from "@/core/artifacts";
import { DomainError } from "@/core/errors";
import { createShareLink, revokeShareLink, ShareLinkNotFoundError } from "@/core/sharing";
import { createSession, hasValidSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { artifactIdSchema, publishMetadataSchema, shareDurationSchema } from "@/lib/validation";

export type FormState = { error?: string };

// Domain errors are expected outcomes with user-safe messages; anything else is an
// unexpected failure (blob/db/infra) — log it with context so it surfaces in the
// server logs instead of vanishing behind the generic message (CLAUDE.md: never
// swallow errors silently), while the user still sees a non-leaky generic string.
function messageFor(error: unknown, context: Record<string, unknown>): string {
  if (error instanceof DomainError) return error.message;
  logger.error({ err: error, ...context }, "web action failed");
  return "Something went wrong. Please try again.";
}

// Token-gate (PLAN §3.4): validate the team token and set the session cookie.
export async function unlockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  if (!(await createSession(token))) return { error: "That token is not correct." };
  redirect("/publish");
}

// Web publish. Auth via session cookie; content + metadata from the form.
export async function publishAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await hasValidSession())) return { error: "Your session expired. Unlock again." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to publish." };
  }

  const rawTags = String(formData.get("tags") ?? "").trim();
  let metadata: ReturnType<typeof publishMetadataSchema.parse>;
  try {
    metadata = publishMetadataSchema.parse({
      title: str(formData.get("title")),
      description: str(formData.get("description")),
      tags: rawTags.length > 0 ? rawTags.split(",") : undefined,
    });
  } catch {
    return { error: "Check the title, description, and tags and try again." };
  }

  let id: string;
  try {
    const artifact = await createArtifact({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || undefined,
      declaredContentType: file.type || undefined,
      source: "web",
      metadata,
    });
    id = artifact.id;
  } catch (error) {
    return { error: messageFor(error, { action: "publish", filename: file.name || undefined }) };
  }

  revalidatePath("/");
  redirect(`/a/${id}`);
}

export async function deleteArtifactAction(formData: FormData): Promise<void> {
  if (!(await hasValidSession())) redirect("/unlock");
  const id = artifactIdSchema.parse(String(formData.get("id")));
  try {
    await deleteArtifact(id);
  } catch (error) {
    // Already gone → idempotent success. Anything else → log with context and
    // rethrow so the error boundary surfaces it (and Vercel logs capture it).
    if (!(error instanceof ArtifactNotFoundError)) {
      logger.error({ err: error, action: "delete", id }, "web action failed");
      throw error;
    }
  }
  revalidatePath("/");
  redirect("/");
}

// Owner-side share-link management (PLAN §3.3). Both actions gate on the session
// before any core call, wrapping the existing sharing core.
export type CreateLinkState = { error?: string; url?: string; expiresInHuman?: string };

export async function createShareLinkAction(
  _prev: CreateLinkState,
  formData: FormData,
): Promise<CreateLinkState> {
  if (!(await hasValidSession())) return { error: "Your session expired. Unlock again." };

  const id = artifactIdSchema.safeParse(String(formData.get("id")));
  const duration = shareDurationSchema.safeParse(String(formData.get("duration")));
  if (!id.success || !duration.success) return { error: "Choose a valid duration and try again." };

  try {
    const link = await createShareLink(id.data, duration.data);
    revalidatePath(`/a/${id.data}`);
    // The token is stored hash-only and unrecoverable later, so return the full URL
    // for a one-time reveal in the UI.
    return { url: link.url, expiresInHuman: link.expiresInHuman };
  } catch (error) {
    return { error: messageFor(error, { action: "create-share-link", id: id.data }) };
  }
}

export async function revokeShareLinkAction(formData: FormData): Promise<void> {
  if (!(await hasValidSession())) redirect("/unlock");
  const linkId = String(formData.get("linkId") ?? "");
  const artifactId = artifactIdSchema.parse(String(formData.get("artifactId")));
  try {
    await revokeShareLink(linkId);
  } catch (error) {
    // Unknown link → idempotent no-op. Anything else → log with context and rethrow.
    if (!(error instanceof ShareLinkNotFoundError)) {
      logger.error({ err: error, action: "revoke-share-link", linkId }, "web action failed");
      throw error;
    }
  }
  revalidatePath(`/a/${artifactId}`);
}

function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}
