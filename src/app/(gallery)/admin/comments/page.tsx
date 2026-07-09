import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listRecentComments } from "@/core/feedback";
import { hasValidSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { pageOffsetSchema } from "@/lib/validation";
import { adminDeleteCommentAction } from "../actions";
import { ConfirmActionButton } from "../confirm-action-button";
import { AdminPagination } from "../pagination";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE_SIZE = 25;

// Comment moderation (PLAN Phase 6.5): the platform-wide feed, newest first —
// external share-view commenting is open by design, so spam cleanup lives here.
// Deleting a comment makes the artifact's synthesis regenerate on next read.
export default async function AdminCommentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await hasValidSession())) redirect("/unlock?next=/admin/comments");
  const sp = await searchParams;
  const offset = pageOffsetSchema.parse(first(sp.offset)) as number;
  const { items, total, limit } = await listRecentComments({ limit: PAGE_SIZE, offset });

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Comments{total > 0 ? ` (${total})` : ""}
        </h2>
        <p className="text-muted-foreground text-sm">
          Newest first, across all artifacts. Deleting is permanent and refreshes the artifact's AI
          feedback summary on its next view.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          No comments yet.
        </p>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Author</TableHead>
                  <TableHead scope="col">Comment</TableHead>
                  <TableHead scope="col">Artifact</TableHead>
                  <TableHead scope="col">Posted</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((comment) => (
                  <TableRow key={comment.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {comment.authorName}
                    </TableCell>
                    <TableCell className="max-w-96">
                      <p className="line-clamp-2 text-sm">{comment.body}</p>
                    </TableCell>
                    <TableCell className="max-w-48">
                      <Link
                        href={`/a/${comment.artifactId}#c-${comment.id}`}
                        className="text-muted-foreground hover:text-primary line-clamp-1 text-sm transition-colors"
                      >
                        {comment.artifactTitle}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(comment.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ConfirmActionButton
                        action={adminDeleteCommentAction}
                        fields={{ commentId: comment.id }}
                        trigger="Delete"
                        title="Delete this comment?"
                        description={`"${comment.body.slice(0, 80)}${comment.body.length > 80 ? "…" : ""}" by ${comment.authorName}. This cannot be undone.`}
                        confirmLabel="Delete comment"
                        successToast="Comment deleted"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <AdminPagination
        basePath="/admin/comments"
        params={{}}
        total={total}
        limit={limit}
        offset={offset}
      />
    </section>
  );
}
