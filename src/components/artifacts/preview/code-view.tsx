// Read-only text/code/JSON viewer. The content is rendered as React children so
// it is HTML-escaped — never dangerouslySetInnerHTML (CLAUDE.md invariant).
export function CodeView({ code, truncated }: { code: string; truncated?: boolean }) {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <pre className="max-h-[70vh] overflow-auto p-4 text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
      {truncated ? (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          Preview truncated — download the file to see the full content.
        </p>
      ) : null}
    </div>
  );
}
