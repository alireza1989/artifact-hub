import { Download, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { ArtifactPreview } from "@/components/artifacts/preview";
import { CodeView } from "@/components/artifacts/preview/code-view";
import { TagChip } from "@/components/artifacts/tag-chip";
import { CommentList } from "@/components/feedback/comment-list";
import { SynthesisCard } from "@/components/feedback/synthesis-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArtifactNotFoundError, getArtifact, getArtifactContent } from "@/core/artifacts";
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

// Kinds whose preview hides the source behind a sandboxed iframe get a Source tab.
// Text-ish kinds already *show* their source as the preview, so no tab for them.
const SOURCE_TAB_KINDS = new Set(["html", "svg"]);
const SOURCE_TEXT_LIMIT = 512 * 1024;

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
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{kindLabel(artifact.kind)}</Badge>
          <span className="text-muted-foreground text-xs">
            Published {formatDate(artifact.createdAt)}
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{artifact.title}</h1>
        {artifact.description ? (
          <p className="text-muted-foreground max-w-2xl leading-relaxed">{artifact.description}</p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <PreviewArea artifact={artifact} />
        </div>

        <aside className="space-y-4 self-start lg:sticky lg:top-20">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2.5 text-sm">
                <Meta label="Type" value={kindLabel(artifact.kind)} />
                <Meta label="Size" value={formatBytes(artifact.sizeBytes)} />
                <Meta label="Source" value={artifact.source} />
                <Meta label="Published" value={formatDate(artifact.createdAt)} />
              </dl>
              {artifact.tags.length > 0 ? (
                <>
                  <Separator className="my-3" />
                  <div className="flex flex-wrap gap-1.5">
                    {artifact.tags.map((tag) => (
                      <TagChip key={tag} tag={tag} />
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <MetadataEditor
              artifactId={artifact.id}
              title={artifact.title}
              description={artifact.description ?? ""}
              tags={artifact.tags}
              suggested={suggested}
            />
          ) : null}

          {canManage ? <ShareManager artifactId={artifact.id} links={shareLinks} /> : null}

          <div className="flex flex-col gap-2">
            <Button asChild variant="outline">
              <a href={`/raw/${artifact.id}?download`}>
                <Download /> Download
              </a>
            </Button>
            {canManage ? <DeleteArtifactButton id={artifact.id} /> : null}
          </div>
        </aside>
      </div>

      <section className="max-w-3xl space-y-4">
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

// Preview hero. HTML/SVG additionally get a Source tab (their sandboxed-iframe
// preview otherwise hides the markup from reviewers) and an open-in-new-tab
// escape hatch pointing at the same sandboxed /raw path.
async function PreviewArea({ artifact }: { artifact: Awaited<ReturnType<typeof getArtifact>> }) {
  if (!SOURCE_TAB_KINDS.has(artifact.kind)) {
    return <ArtifactPreview artifact={artifact} />;
  }

  const { bytes } = await getArtifactContent(artifact.id);
  const truncated = bytes.length > SOURCE_TEXT_LIMIT;
  const source = new TextDecoder().decode(truncated ? bytes.subarray(0, SOURCE_TEXT_LIMIT) : bytes);

  return (
    <Tabs defaultValue="preview">
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        <Button asChild variant="ghost" size="sm">
          <a href={`/raw/${artifact.id}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Open in new tab
          </a>
        </Button>
      </div>
      <TabsContent value="preview">
        <ArtifactPreview artifact={artifact} />
      </TabsContent>
      <TabsContent value="source">
        <CodeView code={source} truncated={truncated} />
      </TabsContent>
    </Tabs>
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
