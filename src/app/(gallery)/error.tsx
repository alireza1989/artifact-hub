"use client";

// Route-level error boundary for the gallery group (PLAN §6 Runtime: global error
// boundary UI). Plain-language, non-technical copy — never a stack trace — with a
// retry that re-runs the failed server render. The DIGEST is deliberately shown
// and console-logged: production RSC errors are message-stripped, and the digest
// is the only handle that correlates a user report / screenshot with the server
// log line (learned debugging /admin/tags, 2026-07-07). It's an opaque hash —
// no message, no user data.
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function GalleryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[artifact-hub] page error${error.digest ? ` digest=${error.digest}` : ""}`);
  }, [error]);

  return (
    <Card className="mx-auto mt-10 w-full max-w-md items-center gap-3 p-10 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">
        We couldn’t load this page. It’s usually temporary — try again in a moment.
      </p>
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
      {error.digest ? (
        <p className="text-muted-foreground/70 text-xs">Error code: {error.digest}</p>
      ) : null}
    </Card>
  );
}
