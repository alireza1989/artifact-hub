import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Gallery skeleton (PLAN §7: skeletons on gallery/artifact). Shown by the App
// Router while the force-dynamic list query runs. aria-busy + a hidden status
// line announce the load to assistive tech.
export default function GalleryLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading artifacts…
      </span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-full max-w-md rounded-lg" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list.
          <Card key={i} className="gap-0 overflow-hidden p-0">
            <Skeleton className="h-40 rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
