import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kindLabel } from "@/lib/format";
import { ARTIFACT_KINDS, type ArtifactKind } from "@/lib/validation";

// Native GET form: search + kind filter work without client JS (progressive
// enhancement). Submitting navigates to `/?q=…&kind=…`. The kind filter stays a
// native <select> for the same reason — radix Select would need client JS.
export function GalleryControls({ q, kind }: { q?: string; kind?: ArtifactKind }) {
  return (
    <form method="get" action="/" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search artifacts…"
          aria-label="Search artifacts"
          className="h-9 bg-background pl-8 dark:bg-background"
        />
      </div>
      <select
        name="kind"
        defaultValue={kind ?? ""}
        aria-label="Filter by type"
        className="border-input bg-background h-9 rounded-lg border px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">All types</option>
        {ARTIFACT_KINDS.map((k) => (
          <option key={k} value={k}>
            {kindLabel(k)}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" className="h-9">
        Search
      </Button>
    </form>
  );
}
