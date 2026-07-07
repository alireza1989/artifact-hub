import { Clock } from "lucide-react";
import { ArtifactPreview } from "@/components/artifacts/preview";
import { numberImagePins } from "@/components/feedback/anchor-utils";
import { AnchorComposeProvider, AnchoredPreview } from "@/components/feedback/anchors";
import { SynthesisCard } from "@/components/feedback/synthesis-card";
import { Badge } from "@/components/ui/badge";
import { getFeedback } from "@/core/feedback";
import { verifyShareToken } from "@/core/sharing";
import { formatExpiresIn, kindLabel } from "@/lib/format";
import { shareTokenSchema } from "@/lib/validation";
import { ShareComments } from "./share-comments";
import { ShareState } from "./share-state";

// A share token grants read access to exactly one artifact for a bounded time, so
// the page must never be cached or statically rendered — a cached copy would serve
// stale expiry/revocation state and leak access past revocation.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Malformed tokens fail at the boundary with no DB round-trip. verifyShareToken is
  // called exactly once per request (its default increments the access counter);
  // no generateMetadata re-verify, which would double-count the view.
  const parsed = shareTokenSchema.safeParse(token);
  const result = parsed.success
    ? await verifyShareToken(parsed.data)
    : ({ ok: false, reason: "invalid" } as const);

  if (!result.ok) return <ShareState reason={result.reason} />;

  const { artifact, expiresAt } = result;
  // getFeedback returns comments + the AI synthesis (regenerated lazily at ≥2
  // comments). External reviewers see the summary too — it's the core review loop.
  const feedback = await getFeedback(artifact.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Badge variant="secondary">{kindLabel(artifact.kind)}</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{artifact.title}</h1>
        {artifact.description ? (
          <p className="text-muted-foreground max-w-2xl leading-relaxed">{artifact.description}</p>
        ) : null}
        {artifact.tags.length > 0 ? (
          // Non-linking chips: a share visitor is external and must not be walked
          // into the gallery (unlike the owner-facing TagChip, which filters browse).
          <div className="flex flex-wrap gap-1.5 pt-1">
            {artifact.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-muted-foreground">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="text-accent-foreground bg-accent/50 border-accent flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <Clock className="size-4 shrink-0" />
        <span>This link expires {formatExpiresIn(expiresAt)}.</span>
      </div>

      {/* Anchored feedback (Phase 6.4/6.9): the provider shares the pending
          anchor between the preview (where it's captured) and the comment form
          (where it's submitted). */}
      <AnchorComposeProvider>
        <AnchoredPreview kind={artifact.kind} pins={numberImagePins(feedback.comments)}>
          <ArtifactPreview artifact={artifact} />
        </AnchoredPreview>

        {feedback.summary ? (
          <SynthesisCard summary={feedback.summary} comments={feedback.comments} />
        ) : null}

        <ShareComments token={token} comments={feedback.comments} />
      </AnchorComposeProvider>
    </div>
  );
}
