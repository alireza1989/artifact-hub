"use client";

import { MapPin, MessageSquarePlus, Quote, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CommentAnchor } from "@/lib/validation";
import { ANCHOR_AFFIX_MAX, ANCHOR_QUOTE_MAX } from "@/lib/validation";
import type { ImagePin } from "./anchor-utils";
import { TEXT_ANCHOR_KINDS } from "./anchor-utils";

// Client-side anchored-feedback UI (PLAN Phase 6.4/6.9).
//   AnchorComposeProvider — pending-anchor state shared by the preview wrapper
//     and the comment form (share view only; owner page renders read-only).
//   AnchoredPreview — wraps the (server-rendered) preview: captures text
//     selections into text-quote anchors, captures clicks on image previews into
//     image-point anchors, renders numbered pins, and answers "jump" events from
//     comment chips by scrolling to + flashing the anchored spot.
//   CommentAnchorChip — the quote/pin chip above an anchored comment.
//   PendingAnchorField — chip + hidden JSON input inside the comment form.

const JUMP_EVENT = "artifact-anchor-jump";

type JumpDetail = { anchor: CommentAnchor; commentId?: string };

function dispatchJump(detail: JumpDetail): void {
  window.dispatchEvent(new CustomEvent<JumpDetail>(JUMP_EVENT, { detail }));
}

// ——— compose context ————————————————————————————————————————————————————————

type ComposeState = {
  pending: CommentAnchor | null;
  setPending: (anchor: CommentAnchor | null) => void;
};

const ComposeContext = createContext<ComposeState | null>(null);

export function AnchorComposeProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<CommentAnchor | null>(null);
  return (
    <ComposeContext.Provider value={{ pending, setPending }}>{children}</ComposeContext.Provider>
  );
}

// Null outside a provider (owner page) → compose UI simply doesn't render.
export function useAnchorCompose(): ComposeState | null {
  return useContext(ComposeContext);
}

// ——— selection / highlight helpers ——————————————————————————————————————————

function captureTextQuote(container: HTMLElement): CommentAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const quote = sel.toString().trim().replace(/\s+/g, " ");
  if (quote.length === 0) return null;

  const start = range.startContainer;
  const end = range.endContainer;
  const prefix =
    start.nodeType === Node.TEXT_NODE
      ? (start.textContent ?? "").slice(Math.max(0, range.startOffset - 30), range.startOffset)
      : "";
  const suffix =
    end.nodeType === Node.TEXT_NODE
      ? (end.textContent ?? "").slice(range.endOffset, range.endOffset + 30)
      : "";
  return {
    type: "text-quote",
    quote: quote.slice(0, ANCHOR_QUOTE_MAX),
    prefix: prefix.slice(-ANCHOR_AFFIX_MAX) || undefined,
    suffix: suffix.slice(0, ANCHOR_AFFIX_MAX) || undefined,
  };
}

// Locate the quote in the rendered preview. Whole quote in one text node first;
// then a leading fragment (rendered markdown splits across inline nodes); a miss
// returns null and the caller degrades gracefully (PLAN 6.4).
function findQuoteRange(container: HTMLElement, quote: string): Range | null {
  const needles = [quote, quote.slice(0, 40)].filter((n) => n.length >= 3);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (const needle of needles) {
    walker.currentNode = container;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const at = text.indexOf(needle);
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        return range;
      }
    }
  }
  return null;
}

function flashRange(range: Range): void {
  // CSS Custom Highlight API: no DOM mutation of React-managed content. Guarded —
  // browsers without it still get the scroll, which is the essential part.
  if (typeof Highlight === "undefined" || !("highlights" in CSS)) return;
  CSS.highlights.set("anchor-flash", new Highlight(range));
  window.setTimeout(() => CSS.highlights.delete("anchor-flash"), 2500);
}

// ——— preview wrapper —————————————————————————————————————————————————————————

export function AnchoredPreview({
  kind,
  pins = [],
  children,
}: {
  kind: string;
  pins?: ImagePin[];
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const compose = useAnchorCompose();
  const canQuote = compose !== null && TEXT_ANCHOR_KINDS.has(kind);
  const canPin = compose !== null && kind === "image";

  // Floating "comment on this" affordance over an active selection.
  const [selection, setSelection] = useState<{
    anchor: CommentAnchor;
    top: number;
    left: number;
  } | null>(null);
  const [flashPin, setFlashPin] = useState<string | null>(null);

  const onMouseUp = useCallback(() => {
    if (!canQuote || !containerRef.current) return;
    const anchor = captureTextQuote(containerRef.current);
    if (!anchor) {
      setSelection(null);
      return;
    }
    const sel = window.getSelection();
    const rect = sel?.getRangeAt(0).getBoundingClientRect();
    const box = containerRef.current.getBoundingClientRect();
    if (!rect) return;
    setSelection({
      anchor,
      top: rect.top - box.top - 36,
      left: Math.max(0, Math.min(rect.left - box.left + rect.width / 2 - 60, box.width - 130)),
    });
  }, [canQuote]);

  const onImageClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canPin || !compose || !containerRef.current) return;
      const img = containerRef.current.querySelector("img");
      if (!img) return;
      const rect = img.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return;
      }
      const xPct = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
      const yPct = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
      compose.setPending({ type: "image-point", xPct, yPct });
    },
    [canPin, compose],
  );

  // Answer jump requests from comment chips.
  useEffect(() => {
    function onJump(event: Event) {
      const { anchor, commentId } = (event as CustomEvent<JumpDetail>).detail;
      const container = containerRef.current;
      if (!container) return;
      if (anchor.type === "text-quote") {
        const range = findQuoteRange(container, anchor.quote);
        if (range) {
          range.startContainer.parentElement?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          flashRange(range);
        } else {
          // Quote no longer matches (content edited) — scroll to the preview and
          // let the chip's own quote text carry the meaning.
          container.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else {
        container.scrollIntoView({ behavior: "smooth", block: "center" });
        if (commentId) {
          setFlashPin(commentId);
          window.setTimeout(() => setFlashPin(null), 2500);
        }
      }
    }
    window.addEventListener(JUMP_EVENT, onJump);
    return () => window.removeEventListener(JUMP_EVENT, onJump);
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: selection/pin capture is a pointer-only enhancement; commenting itself stays fully keyboard-accessible via the form.
    // biome-ignore lint/a11y/useKeyWithClickEvents: same rationale — pointing at a pixel is inherently a pointer gesture; the anchor is optional and the form works without it.
    <div ref={containerRef} className="relative" onMouseUp={onMouseUp} onClick={onImageClick}>
      {children}

      {selection ? (
        <div className="absolute z-20" style={{ top: selection.top, left: selection.left }}>
          <Button
            size="sm"
            className="shadow-md"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              compose?.setPending(selection.anchor);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <MessageSquarePlus /> Comment on this
          </Button>
        </div>
      ) : null}

      {pins.map((pin) => (
        <PinMarker key={pin.commentId} pin={pin} flashing={flashPin === pin.commentId} />
      ))}
      {compose?.pending?.type === "image-point" ? (
        <PinDot xPct={compose.pending.xPct} yPct={compose.pending.yPct} pending />
      ) : null}

      {canPin ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Click a spot on the image to attach your comment to it.
        </p>
      ) : null}
      {canQuote ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Select any text above to comment on that passage.
        </p>
      ) : null}
    </div>
  );
}

// Markers are positioned against the <img> box, which is centered inside the
// preview card — track it so percentages land on the pixels they were made on.
function useImageBox(key: string): {
  ref: React.RefObject<HTMLDivElement | null>;
  box: { top: number; left: number; width: number; height: number } | null;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the caller's invalidation token; the effect reads only refs.
  useEffect(() => {
    const wrapper = ref.current?.parentElement;
    const img = wrapper?.querySelector("img");
    if (!img || !wrapper) return;
    const measure = () => {
      const i = img.getBoundingClientRect();
      const w = wrapper.getBoundingClientRect();
      setBox({ top: i.top - w.top, left: i.left - w.left, width: i.width, height: i.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    img.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      img.removeEventListener("load", measure);
    };
  }, [key]);
  return { ref, box };
}

function PinMarker({ pin, flashing }: { pin: ImagePin; flashing: boolean }) {
  const { ref, box } = useImageBox(pin.commentId);
  return (
    <span ref={ref} className="contents">
      {box ? (
        <button
          type="button"
          aria-label={`Go to comment ${pin.n}`}
          onClick={(e) => {
            e.stopPropagation();
            document
              .getElementById(`c-${pin.commentId}`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className={cn(
            "bg-primary text-primary-foreground ring-background absolute z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold shadow-md ring-2 transition-transform hover:scale-110",
            flashing && "scale-125 animate-pulse",
          )}
          style={{
            top: box.top + (pin.yPct / 100) * box.height,
            left: box.left + (pin.xPct / 100) * box.width,
          }}
        >
          {pin.n}
        </button>
      ) : null}
    </span>
  );
}

function PinDot({ xPct, yPct, pending }: { xPct: number; yPct: number; pending?: boolean }) {
  const { ref, box } = useImageBox(`${xPct},${yPct}`);
  return (
    <span ref={ref} className="contents">
      {box ? (
        <span
          aria-hidden="true"
          className={cn(
            "border-primary bg-primary/30 absolute z-10 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
            pending && "animate-pulse",
          )}
          style={{
            top: box.top + (yPct / 100) * box.height,
            left: box.left + (xPct / 100) * box.width,
          }}
        />
      ) : null}
    </span>
  );
}

// ——— comment-side chips ——————————————————————————————————————————————————————

export function CommentAnchorChip({
  anchor,
  commentId,
  pinNumber,
}: {
  anchor: CommentAnchor;
  commentId: string;
  pinNumber?: number;
}) {
  return (
    <button
      type="button"
      onClick={() => dispatchJump({ anchor, commentId })}
      className="border-primary/30 bg-primary/5 text-foreground/80 hover:bg-primary/10 mb-1.5 flex w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition-colors"
      title="Show where this comment points"
    >
      {anchor.type === "text-quote" ? (
        <>
          <Quote className="text-primary mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2 italic">“{anchor.quote}”</span>
        </>
      ) : (
        <>
          <MapPin className="text-primary mt-0.5 size-3 shrink-0" />
          <span>Pinned to the image{pinNumber ? ` · pin ${pinNumber}` : ""}</span>
        </>
      )}
    </button>
  );
}

export function PendingAnchorField() {
  const compose = useAnchorCompose();
  if (!compose?.pending) return null;
  const anchor = compose.pending;
  return (
    <div className="border-primary/30 bg-primary/5 flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs">
      <input type="hidden" name="anchor" value={JSON.stringify(anchor)} />
      {anchor.type === "text-quote" ? (
        <>
          <Quote className="text-primary mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2 flex-1 italic">“{anchor.quote}”</span>
        </>
      ) : (
        <>
          <MapPin className="text-primary mt-0.5 size-3 shrink-0" />
          <span className="flex-1">Pinned to a spot on the image</span>
        </>
      )}
      <button
        type="button"
        aria-label="Remove anchor"
        onClick={() => compose.setPending(null)}
        className="text-muted-foreground hover:text-foreground mt-0.5"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
