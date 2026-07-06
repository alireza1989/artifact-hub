import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { ArtifactPreview } from "@/components/artifacts/preview";
import { TagChip } from "@/components/artifacts/tag-chip";
import { ArtifactNotFoundError, getArtifact } from "@/core/artifacts";
import { hasValidSession } from "@/lib/auth/session";
import { formatBytes, formatDate, kindLabel } from "@/lib/format";
import { artifactIdSchema } from "@/lib/validation";
import { DeleteArtifactButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let artifact: Awaited<ReturnType<typeof getArtifact>>;
  try {
    artifact = await getArtifact(artifactIdSchema.parse(id));
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) notFound();
    throw error;
  }

  const canManage = await hasValidSession();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {kindLabel(artifact.kind)}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{artifact.title}</h1>
        {artifact.description ? (
          <p className="text-muted-foreground max-w-2xl">{artifact.description}</p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <ArtifactPreview artifact={artifact} />

        <aside className="space-y-6">
          <dl className="border-border bg-card space-y-3 rounded-lg border p-4 text-sm">
            <Meta label="Type" value={kindLabel(artifact.kind)} />
            <Meta label="Size" value={formatBytes(artifact.sizeBytes)} />
            <Meta label="Source" value={artifact.source} />
            <Meta label="Published" value={formatDate(artifact.createdAt)} />
          </dl>

          {artifact.tags.length > 0 ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {artifact.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} />
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <a
              href={`/raw/${artifact.id}?download`}
              className="border-border hover:bg-muted flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              <Download className="size-4" /> Download
            </a>
            {canManage ? <DeleteArtifactButton id={artifact.id} /> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium capitalize">{value}</dd>
    </div>
  );
}
