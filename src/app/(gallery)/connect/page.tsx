import { hasValidSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { ConnectPanel } from "./connect-panel";

export const dynamic = "force-dynamic";

// Reviewer-onboarding page (PLAN Phase 6.6): everything needed to connect an MCP
// client, copy-paste ready. Public — the snippets carry a token placeholder; the
// real token is passed to the client panel only for an unlocked owner session,
// and even then only rendered after an explicit toggle.
export default async function ConnectPage() {
  const env = getEnv();
  const isOwner = await hasValidSession();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Connect via MCP</h1>
        <p className="text-muted-foreground text-sm">
          Talk to this hub from Claude — publish, search, share, and read feedback in natural
          conversation.
        </p>
      </div>
      <ConnectPanel baseUrl={env.APP_BASE_URL} token={isOwner ? env.ADMIN_API_TOKEN : undefined} />
    </div>
  );
}
