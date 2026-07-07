// Artifact detail skeleton (PLAN §7). Mirrors the preview + metadata-sidebar
// layout so the page doesn't jump when content arrives.
export default function ArtifactLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading artifact…
      </span>
      <div className="space-y-2">
        <div className="bg-muted h-3 w-20 animate-pulse rounded" />
        <div className="bg-muted h-8 w-2/3 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="bg-muted h-96 animate-pulse rounded-lg" />
        <div className="space-y-3">
          <div className="bg-muted h-40 animate-pulse rounded-lg" />
          <div className="bg-muted h-10 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  );
}
