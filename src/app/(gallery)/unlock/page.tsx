import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/wordmark";
import { Card, CardContent } from "@/components/ui/card";
import { hasValidSession, safeNextPath } from "@/lib/auth/session";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await hasValidSession()) redirect(safeNextPath(next));

  return (
    <div className="mx-auto mt-10 max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark className="size-9" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Unlock the hub</h1>
          <p className="text-muted-foreground text-sm">
            Enter the team token to browse, publish, and manage artifacts. Share links keep working
            without it.
          </p>
        </div>
      </div>
      <Card>
        <CardContent>
          <UnlockForm next={next} />
        </CardContent>
      </Card>
    </div>
  );
}
