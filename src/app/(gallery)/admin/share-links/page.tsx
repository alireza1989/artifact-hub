import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAllShareLinks, type PlatformShareLink } from "@/core/sharing";
import { hasValidSession } from "@/lib/auth/session";
import { formatDate, formatExpiresIn } from "@/lib/format";
import { pageOffsetSchema } from "@/lib/validation";
import { adminRevokeShareLinkAction } from "../actions";
import { ConfirmActionButton } from "../confirm-action-button";
import { AdminPagination } from "../pagination";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE_SIZE = 25;

function statusOf(link: PlatformShareLink): { label: string; active: boolean } {
  if (link.revokedAt) return { label: "Revoked", active: false };
  if (link.expiresAt.getTime() <= Date.now()) return { label: "Expired", active: false };
  return { label: "Active", active: true };
}

// Platform-wide share-link inventory (PLAN Phase 6.5): every link across every
// artifact, revocable in one click. Before this page, revocation was only
// reachable through each artifact's own share manager.
export default async function AdminShareLinksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await hasValidSession())) redirect("/unlock?next=/admin/share-links");
  const sp = await searchParams;
  const offset = pageOffsetSchema.parse(first(sp.offset)) as number;
  const { items, total, limit } = await listAllShareLinks({ limit: PAGE_SIZE, offset });

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Share links{total > 0 ? ` (${total})` : ""}
        </h2>
        <p className="text-muted-foreground text-sm">
          Every link on the platform. Revoking takes effect immediately; working URLs are never
          recoverable from here.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          No share links have been created yet.
        </p>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Artifact</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Created</TableHead>
                  <TableHead scope="col">Views</TableHead>
                  <TableHead scope="col">Last viewed</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((link) => {
                  const status = statusOf(link);
                  return (
                    <TableRow key={link.id}>
                      <TableCell className="max-w-64">
                        <Link
                          href={`/a/${link.artifactId}`}
                          className="hover:text-primary line-clamp-1 font-medium transition-colors"
                        >
                          {link.artifactTitle}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={status.active ? "default" : "secondary"}>
                          {status.label}
                        </Badge>
                        {status.active ? (
                          <span className="text-muted-foreground ml-2 text-xs">
                            expires {formatExpiresIn(link.expiresAt)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(link.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{link.accessCount}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {link.lastAccessedAt ? formatDate(link.lastAccessedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {status.active ? (
                          <ConfirmActionButton
                            action={adminRevokeShareLinkAction}
                            fields={{ linkId: link.id }}
                            trigger="Revoke"
                            title="Revoke this share link?"
                            description={`Anyone holding the link to "${link.artifactTitle}" loses access immediately. This cannot be undone.`}
                            confirmLabel="Revoke link"
                            successToast="Share link revoked"
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <AdminPagination
        basePath="/admin/share-links"
        params={{}}
        total={total}
        limit={limit}
        offset={offset}
      />
    </section>
  );
}
