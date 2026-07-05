import Link from "next/link";
import { Button } from "@/components/ui/button";

// Walking-skeleton gallery (PLAN Phase 0). The real card grid, search, and filters
// arrive in Phase 1; the empty state here is the §7 "publish your first artifact" CTA.
export default function GalleryPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Artifact Hub</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-balance">
          Publish, browse, review, and share AI-generated content — HTML, images, PDFs, Markdown,
          and more.
        </p>
      </div>

      <div className="border-border bg-card text-card-foreground w-full max-w-md rounded-xl border p-10">
        <p className="font-medium">No artifacts yet</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Your gallery is empty. Publish your first artifact to get started.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href="/publish">Publish your first artifact</Link>
        </Button>
      </div>
    </main>
  );
}
