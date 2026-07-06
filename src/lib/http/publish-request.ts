import type { CreateArtifactInput } from "@/core/artifacts";
import { publishMetadataSchema } from "@/lib/validation";
import { HttpError } from "./errors";

export type ParsedPublish = Omit<CreateArtifactInput, "source">;

const blank = (v: FormDataEntryValue | null): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
};

function normalizeMetadata(raw: {
  title?: string;
  description?: string;
  tags?: unknown;
}): ParsedPublish["metadata"] {
  const tags =
    raw.tags === undefined
      ? undefined
      : Array.isArray(raw.tags)
        ? raw.tags.map(String)
        : String(raw.tags).split(",");
  return publishMetadataSchema.parse({
    title: raw.title,
    description: raw.description,
    tags,
  });
}

// Accept both a browser file upload (multipart/form-data with a `file` field) and
// a programmatic JSON body (inline `content` or base64 `contentBase64`). Produces
// the framework-free input core/createArtifact expects.
export async function parsePublishRequest(req: Request): Promise<ParsedPublish> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "invalid_request", "Expected a `file` field in the form data.");
    }
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || undefined,
      declaredContentType: file.type || undefined,
      metadata: normalizeMetadata({
        title: blank(form.get("title")),
        description: blank(form.get("description")),
        tags: form.getAll("tags").length > 0 ? form.getAll("tags").map(String) : undefined,
      }),
    };
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_request", "Request body must be valid JSON.");
  }

  const bytes = decodeJsonContent(body);
  return {
    bytes,
    filename: typeof body.filename === "string" ? body.filename : undefined,
    declaredContentType: typeof body.contentType === "string" ? body.contentType : undefined,
    metadata: normalizeMetadata({
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      tags: body.tags,
    }),
  };
}

function decodeJsonContent(body: Record<string, unknown>): Uint8Array {
  if (typeof body.contentBase64 === "string") {
    return new Uint8Array(Buffer.from(body.contentBase64, "base64"));
  }
  if (typeof body.content === "string") {
    return new TextEncoder().encode(body.content);
  }
  throw new HttpError(
    400,
    "invalid_request",
    "Provide `content` (inline text) or `contentBase64` (binary), or upload a file.",
  );
}
