import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// Clicking a tag filters the gallery by it (PLAN §7).
export function TagChip({ tag }: { tag: string }) {
  return (
    <Badge asChild variant="secondary">
      <Link href={`/?tag=${encodeURIComponent(tag)}`}>{tag}</Link>
    </Badge>
  );
}
