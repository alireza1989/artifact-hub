import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listTagUsage } from "@/core/artifacts";
import { hasValidSession } from "@/lib/auth/session";
import { TagCleanup } from "./tag-cleanup";

export const dynamic = "force-dynamic";

// Tag management (PLAN Phase 6.7): the vocabulary with usage counts, plus the
// AI-assisted suggest → review → apply cleanup flow.
export default async function AdminTagsPage() {
  if (!(await hasValidSession())) redirect("/unlock");
  const usage = await listTagUsage();

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card size="sm" className="self-start">
        <CardHeader>
          <CardTitle>Tags in use{usage.length > 0 ? ` (${usage.length})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">No tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {usage.map(({ tag, count }) => (
                <Badge key={tag} asChild variant="secondary" className="gap-1">
                  <Link href={`/?tag=${encodeURIComponent(tag)}`}>
                    {tag}
                    <span className="text-muted-foreground tabular-nums">{count}</span>
                  </Link>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <TagCleanup />
    </section>
  );
}
