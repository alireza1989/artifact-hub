import Link from "next/link";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import { GalleryControls } from "@/components/artifacts/gallery-controls";
import { Button } from "@/components/ui/button";
import { listArtifacts } from "@/core/artifacts";
import { type ListQuery, listQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function buildHref(base: ListQuery, offset: number): string {
  const p = new URLSearchParams();
  if (base.q) p.set("q", base.q);
  if (base.kind) p.set("kind", base.kind);
  for (const tag of base.tags ?? []) p.append("tag", tag);
  if (offset > 0) p.set("offset", String(offset));
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const query = listQuerySchema.parse({
    q: first(sp.q),
    kind: first(sp.kind),
    tags: sp.tag,
    sort: first(sp.sort),
    offset: first(sp.offset),
  });
  const { items, total, limit, offset } = await listArtifacts(query);

  const activeTag = query.tags?.[0];
  const hasFilters = Boolean(query.q || query.kind || activeTag);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Browse artifacts</h1>
        <GalleryControls q={query.q} kind={query.kind} />
        {activeTag ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <span>
              Filtered by tag <span className="text-foreground font-medium">{activeTag}</span>
            </span>
            <Link href="/" className="underline underline-offset-2">
              clear
            </Link>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
          <Pagination base={query} total={total} limit={limit} offset={offset} />
        </>
      )}
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="border-border bg-card mx-auto mt-10 w-full max-w-md rounded-xl border p-10 text-center">
      <p className="font-medium">{hasFilters ? "No matching artifacts" : "No artifacts yet"}</p>
      <p className="text-muted-foreground mt-1 text-sm">
        {hasFilters
          ? "Try a different search or clear the filters."
          : "Publish your first artifact to get started."}
      </p>
      {hasFilters ? (
        <Button asChild variant="outline" className="mt-6">
          <Link href="/">Clear filters</Link>
        </Button>
      ) : (
        <Button asChild size="lg" className="mt-6">
          <Link href="/publish">Publish your first artifact</Link>
        </Button>
      )}
    </div>
  );
}

function Pagination({
  base,
  total,
  limit,
  offset,
}: {
  base: ListQuery;
  total: number;
  limit: number;
  offset: number;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="text-muted-foreground flex items-center justify-between text-sm">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" disabled={offset === 0}>
          <Link href={buildHref(base, Math.max(0, offset - limit))}>Previous</Link>
        </Button>
        <Button asChild variant="outline" size="sm" disabled={offset + limit >= total}>
          <Link href={buildHref(base, offset + limit)}>Next</Link>
        </Button>
      </div>
    </div>
  );
}
