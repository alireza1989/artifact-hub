import { NextResponse } from "next/server";
import { listArtifacts, publishArtifact } from "@/core/artifacts";
import { isAuthorized } from "@/lib/http/auth";
import { toErrorResponse, unauthorized } from "@/lib/http/errors";
import { parsePublishRequest } from "@/lib/http/publish-request";
import { listQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/artifacts — full-text search + filters + pagination. Open read.
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const result = await listArtifacts(listQuerySchema.parse(params));
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, { route: "GET /api/v1/artifacts" });
  }
}

// POST /api/v1/artifacts — publish. Bearer-authenticated write.
export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const parsed = await parsePublishRequest(req);
    // Auto-metadata (Feature A) fills any omitted title/description/tags; `aiFilled`
    // reports which fields the AI supplied so a client can flag them for review.
    const { artifact, aiFilled } = await publishArtifact({ ...parsed, source: "api" });
    return NextResponse.json({ ...artifact, aiFilled }, { status: 201 });
  } catch (error) {
    // Context is route + nothing else: publish bodies carry user content, which
    // never belongs in a log line.
    return toErrorResponse(error, { route: "POST /api/v1/artifacts" });
  }
}
