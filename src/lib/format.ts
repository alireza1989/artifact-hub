import type { ArtifactKind } from "@/lib/validation";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const KIND_LABELS: Record<ArtifactKind, string> = {
  html: "HTML",
  image: "Image",
  svg: "SVG",
  pdf: "PDF",
  markdown: "Markdown",
  text: "Text",
  json: "JSON",
  csv: "CSV",
  other: "File",
};

export function kindLabel(kind: ArtifactKind): string {
  return KIND_LABELS[kind];
}
