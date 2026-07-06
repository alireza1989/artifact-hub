import { Download } from "lucide-react";
import { getArtifactContent } from "@/core/artifacts";
import type { Artifact } from "@/db/schema";
import { formatBytes } from "@/lib/format";
import { CodeView } from "./code-view";
import { CsvView } from "./csv-view";
import { MarkdownView } from "./markdown-view";

// Cap inline text rendering; larger files still download in full via /raw.
const PREVIEW_TEXT_LIMIT = 512 * 1024;

async function loadText(id: string): Promise<{ text: string; truncated: boolean }> {
  const { bytes } = await getArtifactContent(id);
  const truncated = bytes.length > PREVIEW_TEXT_LIMIT;
  const slice = truncated ? bytes.subarray(0, PREVIEW_TEXT_LIMIT) : bytes;
  return { text: new TextDecoder().decode(slice), truncated };
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// Renders the right viewer per artifact kind (PLAN §2). Active content (HTML/SVG)
// is isolated in a sandboxed iframe pointed at /raw; passive kinds render inline.
export async function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const raw = `/raw/${artifact.id}`;

  switch (artifact.kind) {
    case "html":
      return (
        <iframe
          src={raw}
          title={artifact.title}
          sandbox="allow-scripts"
          className="border-border h-[70vh] w-full rounded-lg border bg-white"
        />
      );
    case "svg":
      // SVG is active content but needs no scripts: empty sandbox blocks them.
      return (
        <iframe
          src={raw}
          title={artifact.title}
          sandbox=""
          className="border-border h-[70vh] w-full rounded-lg border bg-white"
        />
      );
    case "pdf":
      return (
        <iframe
          src={raw}
          title={artifact.title}
          className="border-border h-[80vh] w-full rounded-lg border"
        />
      );
    case "image":
      return (
        <div className="border-border bg-muted/30 flex justify-center rounded-lg border p-4">
          {/* biome-ignore lint/performance/noImgElement: artifact bytes are served via /raw, not Next-optimizable. */}
          <img src={raw} alt={artifact.title} className="max-h-[75vh] w-auto rounded" />
        </div>
      );
    case "markdown": {
      const { text } = await loadText(artifact.id);
      return <MarkdownView source={text} />;
    }
    case "csv": {
      const { text } = await loadText(artifact.id);
      return <CsvView source={text} />;
    }
    case "json": {
      const { text, truncated } = await loadText(artifact.id);
      return <CodeView code={prettyJson(text)} truncated={truncated} />;
    }
    case "text": {
      const { text, truncated } = await loadText(artifact.id);
      return <CodeView code={text} truncated={truncated} />;
    }
    default:
      return (
        <div className="border-border bg-card flex flex-col items-center gap-3 rounded-lg border p-10 text-center">
          <p className="text-muted-foreground text-sm">
            This file type has no inline preview ({formatBytes(artifact.sizeBytes)}).
          </p>
          <a
            href={`${raw}?download`}
            className="text-primary inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
          >
            <Download className="size-4" /> Download file
          </a>
        </div>
      );
  }
}
