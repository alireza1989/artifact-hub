import { nanoid } from "nanoid";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts } from "@/db/schema";
import type { Storage } from "@/lib/storage";
import { getStorage } from "@/lib/storage";
import type { ArtifactKind, ArtifactSource, PublishMetadata } from "@/lib/validation";
import { MAX_ARTIFACT_BYTES } from "@/lib/validation";
import { EmptyContentError, FileTooLargeError } from "./errors";
import { sniffArtifact } from "./sniff";

export type CreateArtifactInput = {
  bytes: Uint8Array;
  filename?: string;
  declaredContentType?: string;
  source: ArtifactSource;
  metadata?: PublishMetadata;
};

// Canonical extension per kind, used to give the stored blob a sensible pathname.
const KIND_EXTENSION: Record<ArtifactKind, string> = {
  html: "html",
  image: "bin",
  svg: "svg",
  pdf: "pdf",
  markdown: "md",
  text: "txt",
  json: "json",
  csv: "csv",
  other: "bin",
};

const IMAGE_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

function baseName(filename?: string): string | undefined {
  if (!filename) return undefined;
  const base = filename.split(/[\\/]/).pop()?.trim();
  return base && base.length > 0 ? base : undefined;
}

// Deterministic title when the caller supplies none (PLAN §5.1 fallback: publish
// never blocks on AI). Strips the extension from the filename, else names by kind.
function deriveTitle(filename: string | undefined, kind: ArtifactKind): string {
  const base = baseName(filename);
  if (base) {
    const withoutExt = base.replace(/\.[^.]+$/, "").trim();
    if (withoutExt.length > 0) return withoutExt.slice(0, 80);
  }
  return `Untitled ${kind}`;
}

// A collision-proof, path-safe blob key: `<id>/<slug>.<ext>`.
function blobPathname(
  id: string,
  filename: string | undefined,
  contentType: string,
  kind: ArtifactKind,
): string {
  const base = baseName(filename);
  const stem = (base?.replace(/\.[^.]+$/, "") ?? "content")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const ext = IMAGE_EXTENSION[contentType] ?? KIND_EXTENSION[kind];
  return `${id}/${stem || "content"}.${ext}`;
}

export async function createArtifact(
  input: CreateArtifactInput,
  storage: Storage = getStorage(),
): Promise<Artifact> {
  if (input.bytes.length === 0) throw new EmptyContentError();
  if (input.bytes.length > MAX_ARTIFACT_BYTES) throw new FileTooLargeError(input.bytes.length);

  const { contentType, kind } = await sniffArtifact({
    bytes: input.bytes,
    filename: input.filename,
    declaredContentType: input.declaredContentType,
  });

  const id = nanoid();
  const { url } = await storage.put(
    blobPathname(id, input.filename, contentType, kind),
    input.bytes,
    contentType,
  );

  const [row] = await getDb()
    .insert(artifacts)
    .values({
      id,
      title: input.metadata?.title ?? deriveTitle(input.filename, kind),
      description: input.metadata?.description ?? null,
      contentType,
      kind,
      tags: input.metadata?.tags ?? [],
      blobUrl: url,
      sizeBytes: input.bytes.length,
      source: input.source,
    })
    .returning();

  // The insert returns exactly one row; guard for the type-narrowing only.
  if (!row) throw new Error("Insert returned no row");
  return row;
}
