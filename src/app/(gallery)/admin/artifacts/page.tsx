import { ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listArtifacts } from "@/core/artifacts";
import { hasValidSession } from "@/lib/auth/session";
import { formatBytes, formatDate, kindLabel } from "@/lib/format";
import { listQuerySchema } from "@/lib/validation";
import { adminDeleteArtifactAction } from "../actions";
import { ConfirmActionButton } from "../confirm-action-button";
import { AdminPagination } from "../pagination";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Artifact management (PLAN Phase 6.5): search the whole catalog, jump to the
// artifact page to edit metadata (the editor lives there — single edit surface),
// delete from here. Deliberately the plain deterministic search, not NL.
export default async function AdminArtifactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await hasValidSession())) redirect("/unlock?next=/admin/artifacts");
  const sp = await searchParams;
  const query = listQuerySchema.parse({ q: first(sp.q), offset: first(sp.offset), limit: 20 });
  const { items, total, limit, offset } = await listArtifacts(query);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Artifacts{total > 0 ? ` (${total})` : ""}
        </h2>
        <form method="get" action="/admin/artifacts" className="relative w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Search artifacts…"
            aria-label="Search artifacts"
            className="bg-background pl-8 dark:bg-background"
          />
        </form>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          {query.q ? "No artifacts match this search." : "No artifacts yet."}
        </p>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Title</TableHead>
                  <TableHead scope="col">Kind</TableHead>
                  <TableHead scope="col">Size</TableHead>
                  <TableHead scope="col">Comments</TableHead>
                  <TableHead scope="col">Published</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-64">
                      <Link
                        href={`/a/${a.id}`}
                        className="hover:text-primary line-clamp-1 font-medium transition-colors"
                      >
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{kindLabel(a.kind)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatBytes(a.sizeBytes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.commentCount}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(a.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild variant="outline" size="xs">
                          <Link href={`/a/${a.id}`}>
                            <ExternalLink /> Open
                          </Link>
                        </Button>
                        <ConfirmActionButton
                          action={adminDeleteArtifactAction}
                          fields={{ id: a.id }}
                          trigger="Delete"
                          title="Delete this artifact?"
                          description={`"${a.title}" — its share links and all feedback will be permanently removed. This cannot be undone.`}
                          confirmLabel="Delete artifact"
                          successToast="Artifact deleted"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <AdminPagination
        basePath="/admin/artifacts"
        params={query.q ? { q: query.q } : {}}
        total={total}
        limit={limit}
        offset={offset}
      />
    </section>
  );
}
