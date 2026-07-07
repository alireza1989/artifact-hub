import { getArtifactContent } from "@/core/artifacts";
import type { Artifact } from "@/db/schema";
import { logger } from "@/lib/logger";
import { KindIcon } from "./kind-icon";

// Phase 6.2: live gallery previews with NO thumbnail pipeline (PLAN Decision Log
// 2026-07-07) — every thumbnail is a scaled-down render of content the app
// already serves through /raw:
//   - image        <img> straight from /raw (unchanged from Phase 1)
//   - html/svg     the same sandboxed-iframe model as the artifact page, scaled to
//                  card size and made inert (pointer-events-none, tabIndex -1,
//                  aria-hidden) so the card link stays the only interaction target
//   - pdf          browser PDF viewer iframe, toolbar hidden where supported
//   - md/text/json/csv  server-fetched snippet of the first bytes, mono + faded
//   - other        kind icon (no inline preview exists — unchanged)
// A failed snippet fetch degrades to the icon: the gallery never breaks on one
// bad blob.

type CardArtifact = Pick<Artifact, "id" | "kind">;

const SNIPPET_KINDS = new Set<Artifact["kind"]>(["markdown", "text", "json", "csv"]);
const SNIPPET_BYTES = 1500;

export async function CardPreview({ artifact }: { artifact: CardArtifact }) {
  const raw = `/raw/${artifact.id}`;

  switch (artifact.kind) {
    case "image":
      return (
        // biome-ignore lint/performance/noImgElement: artifact bytes are served via /raw, not Next-optimizable.
        <img
          src={raw}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
      );
    // Same sandbox split as the full-page preview (PLAN §2): HTML may run scripts
    // (network access is blocked by /raw's CSP), SVG gets an empty sandbox so
    // embedded scripts can never run.
    case "html":
      return <ScaledFrame src={raw} sandbox="allow-scripts" />;
    case "svg":
      return <ScaledFrame src={raw} sandbox="" />;
    case "pdf":
      return (
        <iframe
          src={`${raw}#toolbar=0&navpanes=0`}
          title="Artifact preview"
          aria-hidden="true"
          tabIndex={-1}
          loading="lazy"
          className="pointer-events-none h-full w-full select-none border-0 bg-white"
        />
      );
    default:
      if (SNIPPET_KINDS.has(artifact.kind)) return <TextSnippet id={artifact.id} />;
      return <IconFallback kind={artifact.kind} />;
  }
}

// Down-scaled live render: the frame lays out at 2× the card's box, then scales
// to 50%, so the page renders at a realistic viewport width and reads as a
// zoomed-out screenshot.
function ScaledFrame({ src, sandbox }: { src: string; sandbox: string }) {
  return (
    <iframe
      src={src}
      sandbox={sandbox}
      title="Artifact preview"
      aria-hidden="true"
      tabIndex={-1}
      loading="lazy"
      className="pointer-events-none absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50 select-none border-0 bg-white"
    />
  );
}

async function TextSnippet({ id }: { id: string }) {
  let snippet: string;
  try {
    // Reads the whole blob (the storage adapter has no ranged read); fine at the
    // sizes text-kind artifacts actually are. Decode may cut a multibyte char at
    // the boundary — irrelevant for a faded thumbnail.
    const { artifact, bytes } = await getArtifactContent(id);
    snippet = new TextDecoder().decode(bytes.subarray(0, SNIPPET_BYTES));
    if (!snippet.trim()) return <IconFallback kind={artifact.kind} />;
  } catch (error) {
    // Never break the gallery over one unreadable blob; log and fall back.
    logger.warn({ err: error, artifactId: id }, "card snippet load failed");
    return <IconFallback kind="text" />;
  }
  return (
    <div aria-hidden="true" className="relative h-full w-full overflow-hidden text-left">
      <pre className="text-muted-foreground h-full w-full overflow-hidden p-3 font-mono text-[10px] leading-4 whitespace-pre-wrap">
        {snippet}
      </pre>
      {/* Fade the cut-off edge so a truncated snippet reads as a preview, not a bug. */}
      <div className="from-muted/40 pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent" />
    </div>
  );
}

function IconFallback({ kind }: { kind: Artifact["kind"] }) {
  return (
    <KindIcon
      kind={kind}
      className="text-muted-foreground/70 size-10 transition-colors group-hover:text-primary/60"
    />
  );
}
