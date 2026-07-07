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

// Friendly relative expiry for the share viewer, e.g. "in 2 days" / "in 5 hours".
// Reads as "This link expires {formatExpiresIn(expiresAt)}." Past due → "expired".
export function formatExpiresIn(target: Date | string): string {
  const ms = (typeof target === "string" ? new Date(target) : target).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
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
