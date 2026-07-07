import type { CommentAnchor } from "@/lib/validation";

// Pure helpers shared by server components (comment lists) and the client-side
// anchor UI. No "use client" — keep these importable from RSCs.

export type AnchoredDisplayComment = {
  id: string;
  anchor?: CommentAnchor | null;
};

export type ImagePin = { commentId: string; xPct: number; yPct: number; n: number };

// Number the image pins by the comments' display order (newest-first everywhere),
// so marker numbers on the preview match the chips in the list.
export function numberImagePins(comments: AnchoredDisplayComment[]): ImagePin[] {
  const pins: ImagePin[] = [];
  for (const comment of comments) {
    if (comment.anchor?.type === "image-point") {
      pins.push({
        commentId: comment.id,
        xPct: comment.anchor.xPct,
        yPct: comment.anchor.yPct,
        n: pins.length + 1,
      });
    }
  }
  return pins;
}

export function pinNumberFor(pins: ImagePin[], commentId: string): number | undefined {
  return pins.find((p) => p.commentId === commentId)?.n;
}

// Kinds whose rendered preview is selectable text (quote-to-comment applies).
// HTML/SVG/PDF live in iframes — deliberately excluded (PLAN Decision Log
// 2026-07-07: no coordinate/selection channel across the sandbox boundary).
export const TEXT_ANCHOR_KINDS = new Set(["markdown", "text", "json", "csv"]);
