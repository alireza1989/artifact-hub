import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kindLabel } from "@/lib/format";
import { ARTIFACT_KINDS, type ArtifactKind } from "@/lib/validation";

// Native GET form: search + kind filter work without client JS (progressive
// enhancement). Submitting navigates to `/?q=…&kind=…`.
export function GalleryControls({ q, kind }: { q?: string; kind?: ArtifactKind }) {
  return (
    <form method="get" action="/" className="flex flex-wrap items-center gap-2">
      <div className="border-border bg-background focus-within:ring-3 focus-within:ring-ring/50 flex min-w-56 flex-1 items-center gap-2 rounded-lg border px-3">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search artifacts…"
          aria-label="Search artifacts"
          className="h-9 w-full bg-transparent text-sm outline-none"
        />
      </div>
      <select
        name="kind"
        defaultValue={kind ?? ""}
        aria-label="Filter by type"
        className="border-border bg-background h-9 rounded-lg border px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">All types</option>
        {ARTIFACT_KINDS.map((k) => (
          <option key={k} value={k}>
            {kindLabel(k)}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
    </form>
  );
}
