"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ShareLinkSummary } from "@/core/sharing";
import { DURATION_LABEL, SHARE_DURATIONS } from "@/lib/validation";
import { type CreateLinkState, createShareLinkAction, revokeShareLinkAction } from "../../actions";

// Owner-facing share-link manager (PLAN §3.3, §7): create a time-limited link, see
// each link's live expiry countdown + access count, and revoke in one click.
export function ShareManager({
  artifactId,
  links,
}: {
  artifactId: string;
  links: ShareLinkSummary[];
}) {
  const [state, action, pending] = useActionState<CreateLinkState, FormData>(
    createShareLinkAction,
    {},
  );

  // Mutation feedback via toast (Phase 6.1). Same effect-on-state pattern as the
  // metadata editor: the action returns a fresh state object per dispatch.
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.url) toast.success("Share link created — copy it below");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Link2 className="text-muted-foreground size-4" /> Share links
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-2">
          <div className="flex gap-2">
            <input type="hidden" name="id" value={artifactId} />
            <select
              name="duration"
              defaultValue="24h"
              aria-label="Link duration"
              className="border-input bg-background h-8 flex-1 rounded-lg border px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {SHARE_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {DURATION_LABEL[d]}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
          {state.error ? (
            <p className="text-destructive text-xs" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>

        {state.url ? <CreatedLink url={state.url} expiresInHuman={state.expiresInHuman} /> : null}

        {links.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No share links yet. Create one to share this artifact outside your team.
          </p>
        ) : (
          <ul className="space-y-2">
            {links.map((link) => (
              <LinkRow key={link.id} artifactId={artifactId} link={link} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// One-time reveal of a freshly created link — the token is stored hash-only, so this
// is the only chance to copy the working URL.
function CreatedLink({ url, expiresInHuman }: { url: string; expiresInHuman?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="border-primary/30 bg-primary/5 space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium">
        Link created{expiresInHuman ? ` · expires in ${expiresInHuman}` : ""}. Copy it now — it
        won’t be shown again.
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={url} aria-label="Share link URL" className="h-7 text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              toast.success("Link copied to clipboard");
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          aria-label="Copy link"
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function LinkRow({ artifactId, link }: { artifactId: string; link: ShareLinkSummary }) {
  const status = link.revokedAt
    ? { label: "Revoked", active: false }
    : new Date(link.expiresAt).getTime() <= Date.now()
      ? { label: "Expired", active: false }
      : { label: "Active", active: true };

  return (
    <li className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-1.5 font-medium">
          <Badge variant={status.active ? "default" : "secondary"} className="text-[10px]">
            {status.label}
          </Badge>
          {status.active ? (
            <span className="text-muted-foreground">
              <Countdown expiresAt={link.expiresAt} />
            </span>
          ) : null}
        </p>
        <p className="text-muted-foreground">
          {link.accessCount} view{link.accessCount === 1 ? "" : "s"}
        </p>
      </div>
      {status.active ? (
        <form action={revokeShareLinkAction} onSubmit={() => toast.success("Share link revoked")}>
          <input type="hidden" name="linkId" value={link.id} />
          <input type="hidden" name="artifactId" value={artifactId} />
          <Button type="submit" variant="destructive" size="xs">
            Revoke
          </Button>
        </form>
      ) : null}
    </li>
  );
}

// Live "expires in 2d 3h" countdown, ticking each second so the owner sees time run
// down without a refresh.
function Countdown({ expiresAt }: { expiresAt: Date | string }) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const ms = target - now;
  if (ms <= 0) return <span>expired</span>;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const text =
    days > 0
      ? `${days}d ${hours}h`
      : hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m ${seconds}s`;
  return <span>expires in {text}</span>;
}
