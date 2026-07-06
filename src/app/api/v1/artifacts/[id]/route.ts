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
  try {
    const id = artifactIdSchema.parse((await params).id);
    return NextResponse.json(await getArtifact(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// DELETE /api/v1/artifacts/:id — bearer-authenticated write.
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!isAuthorized(req)) return unauthorized();
  try {
    const id = artifactIdSchema.parse((await params).id);
    await deleteArtifact(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
