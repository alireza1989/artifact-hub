"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
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

  return (
    <section className="border-border bg-card space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Link2 className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">Share links</h2>
      </div>

      <form action={action} className="space-y-2">
        <div className="flex gap-2">
          <input type="hidden" name="id" value={artifactId} />
          <select
            name="duration"
            defaultValue="24h"
            aria-label="Link duration"
            className="border-border bg-background focus-visible:ring-3 focus-visible:ring-ring/50 flex-1 rounded-lg border px-2 py-1.5 text-sm outline-none"
          >
            {SHARE_DURATIONS.map((d) => (
              <option key={d} value={d}>
                {DURATION_LABEL[d]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create"}
          </button>
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
    </section>
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
        <input
          readOnly
          value={url}
          aria-label="Share link URL"
          className="border-border bg-background w-full rounded-md border px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="border-border hover:bg-muted shrink-0 rounded-md border p-1.5"
          aria-label="Copy link"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function LinkRow({ artifactId, link }: { artifactId: string; link: ShareLinkSummary }) {
  const status = link.revokedAt
    ? { label: "Revoked", tone: "text-muted-foreground" }
    : new Date(link.expiresAt).getTime() <= Date.now()
      ? { label: "Expired", tone: "text-muted-foreground" }
      : { label: "Active", tone: "text-emerald-600 dark:text-emerald-400" };
  const active = status.label === "Active";

  return (
    <li className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
      <div className="min-w-0 space-y-0.5">
        <p className={`font-medium ${status.tone}`}>
          {status.label}
          {active ? (
            <>
              {" · "}
              <Countdown expiresAt={link.expiresAt} />
            </>
          ) : null}
        </p>
        <p className="text-muted-foreground">
          {link.accessCount} view{link.accessCount === 1 ? "" : "s"}
        </p>
      </div>
      {active ? (
        <form action={revokeShareLinkAction}>
          <input type="hidden" name="linkId" value={link.id} />
          <input type="hidden" name="artifactId" value={artifactId} />
          <button
            type="submit"
            className="text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0 rounded-md border px-2 py-1 transition-colors"
          >
            Revoke
          </button>
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
