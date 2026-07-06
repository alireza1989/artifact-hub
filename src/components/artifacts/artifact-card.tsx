import { MessageSquare } from "lucide-react";
import Link from "next/link";
import type { ArtifactListItem } from "@/core/artifacts";
import { formatDate, kindLabel } from "@/lib/format";
import { KindIcon } from "./kind-icon";
import { TagChip } from "./tag-chip";

export function ArtifactCard({ artifact }: { artifact: ArtifactListItem }) {
  return (
    <Link
      href={`/a/${artifact.id}`}
      className="border-border bg-card hover:border-foreground/20 group flex flex-col overflow-hidden rounded-xl border transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="bg-muted/40 relative flex h-36 items-center justify-center overflow-hidden border-b">
        {artifact.kind === "image" ? (
          // biome-ignore lint/performance/noImgElement: artifact bytes are served via /raw, not Next-optimizable.
          <img
            src={`/raw/${artifact.id}`}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <KindIcon kind={artifact.kind} className="text-muted-foreground size-10" />
        )}
        <span className="bg-background/80 text-muted-foreground absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium backdrop-blur">
          {kindLabel(artifact.kind)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-1 font-medium">{artifact.title}</h3>
        {artifact.description ? (
          <p className="text-muted-foreground line-clamp-2 text-sm">{artifact.description}</p>
        ) : null}

        {artifact.tags.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {artifact.tags.slice(0, 3).map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </div>
        ) : null}

        <div className="text-muted-foreground mt-auto flex items-center gap-3 pt-1 text-xs">
          <span>{formatDate(artifact.createdAt)}</span>
          {artifact.commentCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" /> {artifact.commentCount}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
