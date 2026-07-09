"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// The id is what MCP tools speak (get_artifact, create_share_link, …) — one
// click beats selecting it out of the URL bar.
export function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(id).then(
          () => {
            setCopied(true);
            toast.success("Artifact id copied");
            setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error("Couldn't copy — select the id in the URL instead"),
        );
      }}
      title={`Copy artifact id (${id})`}
      aria-label="Copy artifact id"
      className="text-foreground hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 inline-flex max-w-40 items-center gap-1.5 rounded-sm font-medium transition-colors focus-visible:outline-none"
    >
      <span className="truncate font-mono text-xs">{id}</span>
      {copied ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
    </button>
  );
}
