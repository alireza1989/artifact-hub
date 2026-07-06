import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Shared chrome for browse / detail / publish (all in the gallery route group).
export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Artifact Hub
          </Link>
          <Button asChild size="sm">
            <Link href="/publish">
              <Plus /> Publish
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
