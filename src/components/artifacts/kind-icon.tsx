import {
  Braces,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
  Shapes,
  Table,
} from "lucide-react";
import type { ArtifactKind } from "@/lib/validation";

const ICONS: Record<ArtifactKind, LucideIcon> = {
  html: FileCode,
  image: ImageIcon,
  svg: Shapes,
  pdf: FileText,
  markdown: FileText,
  text: FileText,
  json: Braces,
  csv: Table,
  other: File,
};

export function KindIcon({ kind, className }: { kind: ArtifactKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden="true" />;
}
