"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ArtifactNotFoundError, createArtifact, deleteArtifact } from "@/core/artifacts";
import { DomainError } from "@/core/errors";
import { createSession, hasValidSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { artifactIdSchema, publishMetadataSchema } from "@/lib/validation";

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

function str(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}
