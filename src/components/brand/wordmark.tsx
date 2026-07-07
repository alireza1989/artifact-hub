import { cn } from "@/lib/utils";

// Brand mark: two stacked "artifact cards" — the product in one glyph.
// Inline SVG so it inherits currentColor and ships zero extra bytes/requests.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-6", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="7" y="3" width="14" height="14" rx="3.5" className="fill-primary/35" />
      <rect x="3" y="7" width="14" height="14" rx="3.5" className="fill-primary" />
      <path
        d="M6.5 12h7M6.5 15.5h4.5"
        className="stroke-primary-foreground"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark />
      <span className="font-semibold tracking-tight">Artifact Hub</span>
    </span>
  );
}
