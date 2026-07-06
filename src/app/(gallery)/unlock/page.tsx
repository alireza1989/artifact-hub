import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/session";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

export default async function UnlockPage() {
  if (await hasValidSession()) redirect("/publish");

  return (
    <div className="mx-auto mt-10 max-w-sm space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Unlock publishing</h1>
        <p className="text-muted-foreground text-sm">
          Enter the team token to publish and manage artifacts. Browsing stays open to everyone.
        </p>
      </div>
      <UnlockForm />
    </div>
  );
}
