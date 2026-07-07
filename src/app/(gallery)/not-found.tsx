import Link from "next/link";
import { Button } from "@/components/ui/button";

// Friendly 404 for the gallery group (artifact page calls notFound() for unknown
// or malformed ids). Plain copy + a way back, not a bare Next.js 404.
export default function GalleryNotFound() {
  return (
    <div className="border-border bg-card mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-3 rounded-xl border p-10 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Artifact not found</h1>
      <p className="text-muted-foreground text-sm">
        This artifact may have been deleted, or the link is incorrect.
      </p>
      <Button asChild variant="outline" className="mt-2">
        <Link href="/">Back to gallery</Link>
      </Button>
    </div>
  );
}
