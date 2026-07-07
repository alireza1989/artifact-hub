import { Clock } from "lucide-react";
import { ArtifactPreview } from "@/components/artifacts/preview";
import { verifyShareToken } from "@/core/sharing";
import { formatExpiresIn, kindLabel } from "@/lib/format";
import { shareTokenSchema } from "@/lib/validation";

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

  if (!result.ok) {
    // Checkpoint placeholder. The friendly expired/revoked/invalid pages — and the
    // privacy justification for distinguishing them (see Decision Log 2026-07-06) —
    // land in the next slice, after review.
    return (
      <div className="border-border bg-card rounded-lg border p-10 text-center">
        <p className="text-muted-foreground text-sm">This share link isn’t available.</p>
      </div>
    );
  }

  const { artifact, expiresAt } = result;

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
        {artifact.tags.length > 0 ? (
          // Non-linking chips: a share visitor is external and must not be walked
          // into the gallery (unlike the owner-facing TagChip, which filters browse).
          <div className="flex flex-wrap gap-1.5 pt-1">
            {artifact.tags.map((tag) => (
              <span
                key={tag}
                className="border-border bg-muted/50 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="text-muted-foreground bg-muted/40 border-border flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <Clock className="size-4 shrink-0" />
        <span>This link expires {formatExpiresIn(expiresAt)}.</span>
      </div>

      <ArtifactPreview artifact={artifact} />
    </div>
  );
}
