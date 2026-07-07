// Gallery skeleton (PLAN §7: skeletons on gallery/artifact). Shown by the App
// Router while the force-dynamic list query runs. aria-busy + a hidden status
// line announce the load to assistive tech.
export default function GalleryLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading artifacts…
      </span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-9 w-full max-w-md animate-pulse rounded-lg bg-muted" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list.
          <div key={i} className="border-border bg-card overflow-hidden rounded-xl border">
            <div className="bg-muted h-36 animate-pulse" />
            <div className="space-y-2 p-4">
              <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
              <div className="bg-muted h-3 w-full animate-pulse rounded" />
              <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
