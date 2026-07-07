import { formatDate } from "@/lib/format";

type DisplayComment = {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date | string;
};

// Read-only comment list with anchor ids so the synthesis card's citations can
// link straight to the comment they cite (PLAN §5.2 traceability).
export function CommentList({ comments }: { comments: DisplayComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-6 text-center text-sm">
        No feedback yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {comments.map((comment) => (
        <li
          key={comment.id}
          id={`c-${comment.id}`}
          className="border-border bg-card scroll-mt-20 rounded-lg border p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{comment.authorName}</span>
            <span className="text-muted-foreground text-xs">{formatDate(comment.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
        </li>
      ))}
    </ul>
  );
}
