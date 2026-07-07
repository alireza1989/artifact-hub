import Link from "next/link";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import { GalleryControls } from "@/components/artifacts/gallery-controls";
import { BrandMark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Browse artifacts</h1>
          {total > 0 ? (
            <p className="text-muted-foreground text-sm">
              {total} artifact{total === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        <GalleryControls q={query.q} kind={query.kind} />
        {activeTag ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5">
              Filtered by <Badge variant="secondary">{activeTag}</Badge>
            </span>
            <Link
              href="/"
              className="hover:text-foreground underline underline-offset-2 transition-colors"
            >
              clear
            </Link>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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

// Guided empty states (PLAN §7 + Phase 6.1): the no-artifacts state walks a new
// team through the first publish; the no-results state offers a way back out.
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  if (hasFilters) {
    return (
      <Card className="mx-auto mt-10 w-full max-w-md items-center p-10 text-center">
        <p className="font-medium">No matching artifacts</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Try a different search or clear the filters.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/">Clear filters</Link>
        </Button>
      </Card>
    );
  }
  return (
    <Card className="mx-auto mt-10 w-full max-w-lg items-center p-10 text-center">
      <BrandMark className="size-10" />
      <p className="mt-4 text-lg font-semibold tracking-tight">Your hub is empty</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm leading-relaxed">
        Publish anything your team generates — HTML mockups, images, PDFs, Markdown docs — and it
        becomes browsable, previewable, and shareable from here.
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link href="/publish">Publish your first artifact</Link>
      </Button>
      <p className="text-muted-foreground mt-3 text-xs">
        Drag &amp; drop a file, or publish straight from Claude via the MCP server.
      </p>
    </Card>
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
        <PageButton
          href={buildHref(base, Math.max(0, offset - limit))}
          disabled={offset === 0}
          label="Previous"
        />
        <PageButton
          href={buildHref(base, offset + limit)}
          disabled={offset + limit >= total}
          label="Next"
        />
      </div>
    </div>
  );
}

// `disabled` does nothing on an <a>, so at the bounds render a real disabled
// button instead of a still-clickable link.
function PageButton({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{label}</Link>
    </Button>
  );
}
