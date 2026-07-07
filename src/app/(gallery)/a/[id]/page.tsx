import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { ArtifactPreview } from "@/components/artifacts/preview";
import { TagChip } from "@/components/artifacts/tag-chip";
import { CommentList } from "@/components/feedback/comment-list";
import { SynthesisCard } from "@/components/feedback/synthesis-card";
import { ArtifactNotFoundError, getArtifact } from "@/core/artifacts";
import { getFeedback } from "@/core/feedback";
import { listShareLinks } from "@/core/sharing";
import { hasValidSession } from "@/lib/auth/session";
import { formatBytes, formatDate, kindLabel } from "@/lib/format";
import { artifactIdSchema } from "@/lib/validation";
import { DeleteArtifactButton } from "./delete-button";
import { MetadataEditor } from "./metadata-editor";
import { ShareManager } from "./share-manager";

export const dynamic = "force-dynamic";

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

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
  // getFeedback lazily (re)generates the synthesis when there are ≥2 comments.
  const [shareLinks, feedback] = await Promise.all([
    canManage ? listShareLinks(artifact.id) : Promise.resolve([]),
    getFeedback(artifact.id),
  ]);

  // A field still shows the "suggested" badge only while its value equals what the
  // AI proposed; editing it makes the badge disappear (PLAN §5.1).
  const ai = artifact.aiGeneratedMeta;
  const suggested = {
    title: !!ai?.title && ai.title === artifact.title,
    description: !!ai?.description && ai.description === (artifact.description ?? ""),
    tags: !!ai?.tags && sameTags(ai.tags, artifact.tags),
  };

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

          {canManage ? (
            <MetadataEditor
              artifactId={artifact.id}
              title={artifact.title}
              description={artifact.description ?? ""}
              tags={artifact.tags}
              suggested={suggested}
            />
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

          {canManage ? <ShareManager artifactId={artifact.id} links={shareLinks} /> : null}
        </aside>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Feedback{feedback.total > 0 ? ` (${feedback.total})` : ""}
        </h2>
        {feedback.summary ? (
          <SynthesisCard summary={feedback.summary} comments={feedback.comments} />
        ) : null}
        <CommentList comments={feedback.comments} />
      </section>
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
