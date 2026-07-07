import { extractText } from "unpdf";
import type { ArtifactKind } from "@/lib/validation";

// Per-feature input cap (PLAN §5.3): metadata extraction is truncated with head +
// tail sampling before the model call so a huge document can't blow the budget or
// context. Chars are a deterministic proxy for tokens — no tokenizer dependency.
export const METADATA_HEAD_CHARS = 12_000;
export const METADATA_TAIL_CHARS = 4_000;

// Anthropic vision accepts these image media types; anything else (e.g. avif) has
// no text and no vision path, so metadata falls back deterministically.
const VISION_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
type VisionMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type MetadataExtract =
  | { mode: "text"; text: string }
  | { mode: "image"; mediaType: VisionMediaType; base64: string }
  | { mode: "none" };

export type ExtractInput = {
  bytes: Uint8Array;
  kind: ArtifactKind;
  contentType: string;
  filename?: string;
};

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// Keep the head and the tail so both a document's intro and its conclusion inform
// the metadata, dropping the (usually most repetitive) middle.
export function headTailSample(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}\n…\n${text.slice(text.length - tail)}`;
}

// Strip scripts/styles and tags, leaving human-readable text (HTML and SVG).
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Header + a sample of rows is enough to describe a CSV without shipping the whole
// file.
function csvSample(csv: string): string {
  return csv.split(/\r?\n/).slice(0, 30).join("\n");
}

// Extract the descriptive signal for Feature A. Returns `none` when there's nothing
// meaningful to send (opaque binaries, unsupported images) so the caller uses the
// deterministic filename fallback instead of a wasted call.
export async function extractForMetadata(input: ExtractInput): Promise<MetadataExtract> {
  const { bytes, kind, contentType } = input;

  if (kind === "image") {
    if (!VISION_MEDIA_TYPES.has(contentType)) return { mode: "none" };
    return {
      mode: "image",
      mediaType: contentType as VisionMediaType,
      base64: Buffer.from(bytes).toString("base64"),
    };
  }

  if (kind === "pdf") {
    try {
      // Copy the bytes: pdfjs may transfer/detach the backing buffer, which would
      // corrupt the same Uint8Array the caller later stores to blob.
      const { text } = await extractText(bytes.slice(), { mergePages: true });
      const flat = (Array.isArray(text) ? text.join("\n") : text).trim();
      if (flat.length === 0) return { mode: "none" };
      return { mode: "text", text: headTailSample(flat, METADATA_HEAD_CHARS, METADATA_TAIL_CHARS) };
    } catch {
      return { mode: "none" };
    }
  }

  if (kind === "other") return { mode: "none" };

  // Remaining kinds are text: html, svg, markdown, text, json, csv.
  const raw = decode(bytes);
  let text: string;
  if (kind === "html" || kind === "svg") text = htmlToText(raw);
  else if (kind === "csv") text = csvSample(raw);
  else text = raw;

  text = text.trim();
  if (text.length === 0) return { mode: "none" };
  return { mode: "text", text: headTailSample(text, METADATA_HEAD_CHARS, METADATA_TAIL_CHARS) };
}
