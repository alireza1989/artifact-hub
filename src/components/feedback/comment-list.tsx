import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

type DisplayComment = {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date | string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// Read-only comment list with anchor ids so the synthesis card's citations can
// link straight to the comment they cite (PLAN §5.2 traceability).
export function CommentList({ comments }: { comments: DisplayComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
        No feedback yet — comments left here or on a share link show up in this list.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {comments.map((comment) => (
        <li key={comment.id} id={`c-${comment.id}`} className="scroll-mt-20">
          <Card size="sm" className="flex-row gap-3 px-4">
            <Avatar className="mt-0.5 size-7">
              <AvatarFallback className="bg-accent text-accent-foreground text-[10px] font-semibold">
                {initials(comment.authorName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{comment.authorName}</span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(comment.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
