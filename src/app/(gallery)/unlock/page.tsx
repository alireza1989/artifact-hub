import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/wordmark";
import { Card, CardContent } from "@/components/ui/card";
import { hasValidSession } from "@/lib/auth/session";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

export default async function UnlockPage() {
  if (await hasValidSession()) redirect("/publish");

  return (
    <div className="mx-auto mt-10 max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <BrandMark className="size-9" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Unlock publishing</h1>
          <p className="text-muted-foreground text-sm">
            Enter the team token to publish and manage artifacts. Browsing stays open to everyone.
          </p>
        </div>
      </div>
      <Card>
        <CardContent>
          <UnlockForm />
        </CardContent>
      </Card>
    </div>
  );
}
