import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/session";
import { PublishForm } from "./publish-form";

export const dynamic = "force-dynamic";

export default async function PublishPage() {
  if (!(await hasValidSession())) redirect("/unlock?next=/publish");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Publish an artifact</h1>
        <p className="text-muted-foreground text-sm">
          Upload any file — its type is detected automatically and previewed for reviewers.
        </p>
      </div>
      <PublishForm />
    </div>
  );
}
