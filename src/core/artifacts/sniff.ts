import { fileTypeFromBuffer } from "file-type";
import type { ArtifactKind } from "@/lib/validation";

// Server-side content sniffing (PLAN §2). Two tiers:
//   1. Magic bytes via `file-type` — authoritative for binaries (images, pdf).
//   2. Content + extension classifier for text formats, which carry no magic
//      bytes and so are invisible to tier 1 (html, svg, markdown, csv, json, text).
// The sniffed type always wins over a client-declared type or file extension
// (PLAN §2: "extension/MIME mismatch → stored under sniffed type").

export type SniffInput = {
  bytes: Uint8Array;
  filename?: string;
  declaredContentType?: string;
};

export type SniffResult = { contentType: string; kind: ArtifactKind };

// Binary MIME → kind, for whatever `file-type` recognizes from magic bytes.
const BINARY_MIME_KIND: Record<string, ArtifactKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/avif": "image",
  "application/pdf": "pdf",
};

// Types `file-type` may report for text containers whose real kind is only
// decidable from content (an XML declaration ≠ SVG; HTML markup ≠ its subtype).
const INCONCLUSIVE_MIMES = new Set(["application/xml", "text/xml", "text/html", "text/plain"]);

// Extension → canonical type, for text formats tier 1 cannot see.
const EXT_TYPE: Record<string, SniffResult> = {
  html: { contentType: "text/html", kind: "html" },
  htm: { contentType: "text/html", kind: "html" },
  svg: { contentType: "image/svg+xml", kind: "svg" },
  md: { contentType: "text/markdown", kind: "markdown" },
  markdown: { contentType: "text/markdown", kind: "markdown" },
  csv: { contentType: "text/csv", kind: "csv" },
  json: { contentType: "application/json", kind: "json" },
  txt: { contentType: "text/plain", kind: "text" },
  text: { contentType: "text/plain", kind: "text" },
};

// Code files all render through the same read-only "text" viewer.
const CODE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "php",
  "swift",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "sql",
  "css",
  "scss",
  "sass",
  "less",
  "xml",
  "log",
  "env",
  "dockerfile",
  "makefile",
  "r",
  "lua",
  "pl",
  "dart",
  "scala",
]);

function extensionOf(filename?: string): string | undefined {
  if (!filename) return undefined;
  const base = filename.toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return base.slice(dot + 1);
}

// Decode as UTF-8, returning null when the bytes are not valid text (or contain
// NUL, a strong binary signal). Only the head is inspected for the null check to
// stay cheap on large inputs.
function decodeText(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, 4096);
  if (head.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Heuristic: ≥2 lines that each split into the same number (≥2) of comma columns.
function looksLikeCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const cols = lines[0]?.split(",").length ?? 0;
  if (cols < 2) return false;
  return lines.slice(0, 5).every((l) => l.split(",").length === cols);
}

export async function sniffArtifact(input: SniffInput): Promise<SniffResult> {
  // Tier 1: magic bytes. Authoritative for binaries. Text-container types
  // (XML/HTML/plain) are inconclusive here — an XML declaration only proves the
  // file is XML, not whether it is SVG — so we defer those to the tier-2
  // classifier instead of mislabeling them as "other".
  const detected = await fileTypeFromBuffer(input.bytes);
  if (detected) {
    const kind = BINARY_MIME_KIND[detected.mime];
    if (kind) return { contentType: detected.mime, kind };
    if (!INCONCLUSIVE_MIMES.has(detected.mime)) {
      // A recognized binary we don't specially preview (zip, office, media…).
      return { contentType: detected.mime, kind: "other" };
    }
  }

  // Tier 2: text classifier.
  const text = decodeText(input.bytes);
  if (text === null) {
    return {
      contentType: input.declaredContentType || "application/octet-stream",
      kind: "other",
    };
  }

  const head = text.slice(0, 512).trimStart().toLowerCase();
  const ext = extensionOf(input.filename);

  // Structural signals win over extension so a mislabeled file is stored honestly.
  // SVG before HTML: both are angle-bracket markup, SVG is the more specific root.
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return { contentType: "image/svg+xml", kind: "svg" };
  }
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || /<html[\s>]/.test(head)) {
    return { contentType: "text/html", kind: "html" };
  }
  if ((head.startsWith("{") || head.startsWith("[")) && isValidJson(text)) {
    return { contentType: "application/json", kind: "json" };
  }

  // Extension is the reliable signal for the remaining text formats.
  if (ext && EXT_TYPE[ext]) {
    const byExt = EXT_TYPE[ext];
    if (byExt.kind === "json" && !isValidJson(text)) {
      return { contentType: "text/plain", kind: "text" };
    }
    return byExt;
  }
  if (ext && CODE_EXTENSIONS.has(ext)) {
    return { contentType: "text/plain", kind: "text" };
  }

  // Declared-type hint, then content heuristics, then plain text as the floor.
  const declared = input.declaredContentType;
  if (declared === "text/markdown") return { contentType: "text/markdown", kind: "markdown" };
  if (declared === "text/csv") return { contentType: "text/csv", kind: "csv" };
  if (declared === "text/html") return { contentType: "text/html", kind: "html" };
  if (looksLikeCsv(text)) return { contentType: "text/csv", kind: "csv" };

  return { contentType: "text/plain", kind: "text" };
}
