import Link from "next/link";

// Clicking a tag filters the gallery by it (PLAN §7).
export function TagChip({ tag }: { tag: string }) {
  return (
    <Link
      href={`/?tag=${encodeURIComponent(tag)}`}
      className="border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-xs transition-colors"
    >
      {tag}
    </Link>
  );
}
