import { NextResponse } from "next/server";
import { createArtifact, listArtifacts } from "@/core/artifacts";
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
    return toErrorResponse(error);
  }
}

// POST /api/v1/artifacts — publish. Bearer-authenticated write.
export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const parsed = await parsePublishRequest(req);
    const artifact = await createArtifact({ ...parsed, source: "api" });
    return NextResponse.json(artifact, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
