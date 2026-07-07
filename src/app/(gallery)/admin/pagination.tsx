import Link from "next/link";
import { Button } from "@/components/ui/button";

// Shared Prev/Next pagination for admin tables. `disabled` does nothing on an
// <a>, so bounds render real disabled buttons (same fix as the gallery).
export function AdminPagination({
  basePath,
  params,
  total,
  limit,
  offset,
}: {
  basePath: string;
  params: Record<string, string>;
  total: number;
  limit: number;
  offset: number;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);

  const href = (nextOffset: number) => {
    const p = new URLSearchParams(params);
    if (nextOffset > 0) p.set("offset", String(nextOffset));
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="text-muted-foreground flex items-center justify-between text-sm">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        {offset === 0 ? (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(Math.max(0, offset - limit))}>Previous</Link>
          </Button>
        )}
        {offset + limit >= total ? (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(offset + limit)}>Next</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
