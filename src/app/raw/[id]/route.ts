import { NextResponse } from "next/server";
import { ArtifactNotFoundError, getArtifactContent } from "@/core/artifacts";
import type { Artifact } from "@/db/schema";
import { toErrorResponse } from "@/lib/http/errors";
import type { ArtifactKind } from "@/lib/validation";
import { artifactIdSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Content-Security-Policy per kind. The security model (CLAUDE.md invariants):
//   - HTML may run inline scripts (interactive artifacts) but `connect-src 'none'`
//     blocks all network access, so a script cannot exfiltrate. The `sandbox`
//     directive re-sandboxes the response even on direct navigation, and omitting
//     `allow-same-origin` keeps it in an opaque origin isolated from the app.
//   - SVG is active content too but never needs scripts, so it gets no
//     `allow-scripts` — embedded <script> simply cannot run.
//   - Everything else is passive; lock it all the way down.
const CSP_HTML = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-scripts",
].join("; ");

const CSP_SVG = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "sandbox",
].join("; ");

// PDFs render in the browser's built-in viewer; the `sandbox` directive can break
// it, so passive content omits it and simply forbids active subresources.
const CSP_PASSIVE = [
  "default-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'unsafe-inline'",
  "object-src 'self'",
  "frame-ancestors 'self'",
].join("; ");

function cspFor(kind: ArtifactKind): string {
  if (kind === "html") return CSP_HTML;
  if (kind === "svg") return CSP_SVG;
  return CSP_PASSIVE;
}

const TEXT_KINDS = new Set<ArtifactKind>(["html", "svg", "markdown", "text", "json", "csv"]);

function contentTypeHeader(artifact: Artifact): string {
  return TEXT_KINDS.has(artifact.kind)
    ? `${artifact.contentType}; charset=utf-8`
    : artifact.contentType;
}

// GET /raw/:id — serves artifact bytes under the security headers above. Used as
// the src for sandboxed HTML/SVG iframes, <img>/<embed> sources, and downloads.
export async function GET(req: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const id = artifactIdSchema.parse((await params).id);
    const { artifact, bytes } = await getArtifactContent(id);
    const download = new URL(req.url).searchParams.has("download");

    const headers = new Headers({
      "Content-Type": contentTypeHeader(artifact),
      "Content-Security-Policy": cspFor(artifact.kind),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": download ? "attachment" : "inline",
    });

    return new NextResponse(Buffer.from(bytes), { headers });
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      return new NextResponse("Artifact not found", { status: 404 });
    }
    return toErrorResponse(error);
  }
}
