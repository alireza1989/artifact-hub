import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ArtifactListItem } from "@/core/artifacts";
import { formatDate, kindLabel } from "@/lib/format";
import { CardPreview } from "./card-preview";
import { KindIcon } from "./kind-icon";
import { TagChip } from "./tag-chip";

export function ArtifactCard({ artifact }: { artifact: ArtifactListItem }) {
  return (
    <Card className="group relative gap-0 overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50">
      <div className="bg-muted/40 relative flex h-40 items-center justify-center overflow-hidden border-b">
        {/* Live per-kind preview (Phase 6.2). Snippet kinds fetch server-side, so
            Suspense streams the card in with the icon until the snippet lands. */}
        <Suspense
          fallback={
            <KindIcon
              kind={artifact.kind}
              className="text-muted-foreground/70 size-10 transition-colors group-hover:text-primary/60"
            />
          }
        >
          <CardPreview artifact={artifact} />
        </Suspense>
        <Badge
          variant="outline"
          className="bg-background/85 text-muted-foreground absolute top-2.5 left-2.5 backdrop-blur"
        >
          {kindLabel(artifact.kind)}
        </Badge>
        {artifact.commentCount > 0 ? (
          <Badge
            variant="outline"
            className="bg-background/85 text-muted-foreground absolute top-2.5 right-2.5 gap-1 backdrop-blur"
            aria-label={`${artifact.commentCount} comment${artifact.commentCount === 1 ? "" : "s"}`}
          >
            <MessageSquare aria-hidden="true" className="size-3" />
            {artifact.commentCount}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-1 font-medium tracking-tight">
          {/* Stretched link: the whole card is clickable, tags stay independently focusable. */}
          <Link
            href={`/a/${artifact.id}`}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {artifact.title}
          </Link>
        </h3>
        {artifact.description ? (
          <p className="text-muted-foreground line-clamp-2 text-sm">{artifact.description}</p>
        ) : null}

        {artifact.tags.length > 0 ? (
          <div className="relative z-10 mt-auto flex w-fit flex-wrap gap-1 pt-1">
            {artifact.tags.slice(0, 3).map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </div>
        ) : null}

        <div className="text-muted-foreground mt-auto flex items-center gap-3 pt-1 text-xs">
          <span>{formatDate(artifact.createdAt)}</span>
        </div>
      </div>
    </Card>
  );
}
