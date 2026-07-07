import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FeedbackSummary } from "@/lib/validation";

// AI feedback synthesis card (PLAN §5.2, §7). Each point links back to the
// comments it cites (anchors into the comment list), so every claim is traceable.
// Rendered only when a summary exists (≥2 comments); absence is the correct UX
// below the threshold, so this component is simply not shown there.

const SENTIMENT: Record<FeedbackSummary["sentiment"], { label: string; className: string }> = {
  positive: {
    label: "Positive",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  mixed: { label: "Mixed", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  negative: { label: "Negative", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400" },
};

type PointList = FeedbackSummary["consensus"];

export function SynthesisCard({
  summary,
  comments,
}: {
  summary: FeedbackSummary;
  comments: { id: string; authorName: string }[];
}) {
  const authorById = new Map(comments.map((c) => [c.id, c.authorName]));
  const sentiment = SENTIMENT[summary.sentiment];
  const empty =
    summary.consensus.length === 0 &&
    summary.disagreements.length === 0 &&
    summary.actionItems.length === 0;

  return (
    <Card size="sm" className="border-l-2 border-l-primary/40">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Sparkles className="text-primary size-4" />
          Feedback summary
          <Badge className={`border-transparent ${sentiment.className}`}>{sentiment.label}</Badge>
          <span className="text-muted-foreground ml-auto text-xs font-normal">
            AI-generated · verify
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Group title="Consensus" points={summary.consensus} authorById={authorById} />
        <Group title="Disagreements" points={summary.disagreements} authorById={authorById} />
        <Group title="Action items" points={summary.actionItems} authorById={authorById} />

        {empty ? (
          <p className="text-muted-foreground text-sm">No clear themes across the comments yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Group({
  title,
  points,
  authorById,
}: {
  title: string;
  points: PointList;
  authorById: Map<string, string>;
}) {
  if (points.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</p>
      <ul className="space-y-1.5">
        {points.map((point) => (
          <li key={`${title}-${point.point}`} className="text-sm leading-relaxed">
            {point.point}{" "}
            <span className="ml-0.5 inline-flex flex-wrap gap-1 align-middle">
              {point.commentIds.map((id) => (
                <a
                  key={id}
                  href={`#c-${id}`}
                  className="bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded px-1.5 py-0.5 text-[10px] no-underline transition-colors"
                >
                  {authorById.get(id) ?? "reviewer"}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
