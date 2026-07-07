import { NextResponse } from "next/server";
import { deleteArtifact, getArtifact } from "@/core/artifacts";
import { isAuthorized } from "@/lib/http/auth";
import { toErrorResponse, unauthorized } from "@/lib/http/errors";
import { artifactIdSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/artifacts/:id — full metadata. Open read.
export async function GET(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  try {
    return NextResponse.json(await getArtifact(artifactIdSchema.parse(id)));
  } catch (error) {
    return toErrorResponse(error, { route: "GET /api/v1/artifacts/:id", id });
  }
}

// DELETE /api/v1/artifacts/:id — bearer-authenticated write.
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await params;
  try {
    await deleteArtifact(artifactIdSchema.parse(id));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error, { route: "DELETE /api/v1/artifacts/:id", id });
  }
}
