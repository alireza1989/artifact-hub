import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Markdown → sanitized React elements (PLAN §2). rehype-sanitize strips scripts
// and dangerous attributes; react-markdown never uses dangerouslySetInnerHTML, so
// untrusted content can only render as inert, whitelisted nodes.
export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="markdown border-border bg-card rounded-lg border p-6">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </Markdown>
    </div>
  );
}
