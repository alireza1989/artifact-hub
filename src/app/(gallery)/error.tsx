"use client";

// Route-level error boundary for the gallery group (PLAN §6 Runtime: global error
// boundary UI). Plain-language, non-technical copy — never a stack trace — with a
// retry that re-runs the failed server render.
import { Button } from "@/components/ui/button";

export default function GalleryError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="border-border bg-card mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-3 rounded-xl border p-10 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">
        We couldn’t load this page. It’s usually temporary — try again in a moment.
      </p>
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
