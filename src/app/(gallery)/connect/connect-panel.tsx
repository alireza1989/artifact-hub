"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildAuthHeaderSnippet,
  buildDesktopConfigSnippet,
  mcpEndpointUrl,
} from "@/lib/mcp-snippets";

// Copy-paste MCP connection panel (PLAN Phase 6.6). `token` is present ONLY for
// an unlocked owner session; even then the snippets render the placeholder until
// the owner explicitly toggles it in — so a screen-share or copy-paste slip
// never leaks the token by default.
export function ConnectPanel({ baseUrl, token }: { baseUrl: string; token?: string }) {
  const [includeToken, setIncludeToken] = useState(false);
  const effectiveToken = includeToken ? token : undefined;
  const url = mcpEndpointUrl(baseUrl);

  return (
    <div className="space-y-4">
      {token ? (
        <label className="border-border bg-card flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={includeToken}
            onChange={(e) => setIncludeToken(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="flex items-center gap-1 font-medium">
              <KeyRound className="size-3.5" /> Include my team token in the snippets
            </span>
            <span className="text-muted-foreground text-xs">
              Off by default so nothing sensitive is copied by accident. Anyone with the token can
              publish and manage artifacts.
            </span>
          </span>
        </label>
      ) : (
        <p className="text-muted-foreground text-sm">
          Snippets use a <code className="bg-muted rounded px-1">{"<YOUR_TEAM_TOKEN>"}</code>{" "}
          placeholder — replace it with the team token from whoever runs this hub.
        </p>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle>1 · Claude Desktop / claude.ai (remote connector)</CardTitle>
          <CardDescription>
            Settings → Connectors → “Add custom connector”, then paste:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <SnippetRow label="Server URL" text={url} />
          <SnippetRow label="Authorization header" text={buildAuthHeaderSnippet(effectiveToken)} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>2 · stdio clients (via mcp-remote)</CardTitle>
          <CardDescription>
            For clients that only speak stdio, add this to{" "}
            <code className="bg-muted rounded px-1 text-xs">claude_desktop_config.json</code>:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnippetBlock text={buildDesktopConfigSnippet(baseUrl, effectiveToken)} />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        Read tools (search, get, feedback) work without a token; publishing, sharing, and deleting
        require it. Once connected, try:{" "}
        <em>“publish this HTML to the hub and share it for 72 hours”</em>.
      </p>
    </div>
  );
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    (text: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopied(false), 1500);
      });
    },
  ];
}

function SnippetRow({ label, text }: { label: string; text: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md px-2 py-1.5 text-xs whitespace-nowrap">
          {text}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Copy ${label}`}
          onClick={() => copy(text)}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function SnippetBlock({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="relative">
      <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Copy configuration"
        className="absolute top-2 right-2"
        onClick={() => copy(text)}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
