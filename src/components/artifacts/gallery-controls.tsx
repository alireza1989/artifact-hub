"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kindLabel } from "@/lib/format";
import { ARTIFACT_KINDS, type ArtifactKind } from "@/lib/validation";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

const selectClass =
  "border-input bg-background h-9 rounded-lg border px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Native GET form: search + filters + sort work without client JS (progressive
// enhancement). Submitting navigates to `/?q=…&kind=…&sort=…`. The selects stay
// native for the same reason — radix Select would need client JS.
export function GalleryControls({
  q,
  kind,
  sort,
  showReset,
}: {
  q?: string;
  kind?: ArtifactKind;
  sort?: "recent" | "oldest";
  showReset?: boolean;
}) {
  // Press "/" anywhere on the gallery to jump to search (ignored while typing).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form method="get" action="/" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          ref={searchRef}
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search artifacts…"
          aria-label="Search artifacts"
          className="h-9 bg-background pr-8 pl-8 dark:bg-background"
        />
        <kbd className="border-border text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border px-1.5 font-mono text-[10px] sm:inline-block">
          /
        </kbd>
      </div>
      <select
        name="kind"
        defaultValue={kind ?? ""}
        aria-label="Filter by type"
        className={selectClass}
      >
        <option value="">All types</option>
        {ARTIFACT_KINDS.map((k) => (
          <option key={k} value={k}>
            {kindLabel(k)}
          </option>
        ))}
      </select>
      <select
        name="sort"
        defaultValue={sort ?? "recent"}
        aria-label="Sort order"
        className={selectClass}
      >
        <option value="recent">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      <Button type="submit" variant="outline" className="h-9">
        Search
      </Button>
      {showReset ? (
        <Button asChild variant="ghost" className="h-9">
          <Link href="/">Reset</Link>
        </Button>
      ) : null}
    </form>
  );
}
