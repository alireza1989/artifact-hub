import { ImageResponse } from "next/og";
import { verifyShareToken } from "@/core/sharing";
import { kindLabel } from "@/lib/format";
import { shareTokenSchema } from "@/lib/validation";

// Branded OG card for share links (PLAN Phase 6.8): pasted links unfurl with the
// artifact's title + kind. Verified with countAccess:false (crawler fetches must
// never count as views); an invalid/expired token renders the generic brand card
// — no information beyond what the link itself grants, and nothing artifact-
// derived is executed (plain text into an image).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Shared via Artifact Hub";

const INDIGO = "#4f52d9";
const INK = "#16181f";
const MUTED = "#5b5f6e";

export default async function OpengraphImage({ params }: { params: { token: string } }) {
  const parsed = shareTokenSchema.safeParse(params.token);
  const result = parsed.success
    ? await verifyShareToken(parsed.data, { countAccess: false })
    : ({ ok: false } as const);

  const title = result.ok ? result.artifact.title : "A shared artifact";
  const kind = result.ok ? kindLabel(result.artifact.kind) : null;
  const description = result.ok ? (result.artifact.description ?? "") : "";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: "#f7f7fb",
        backgroundImage: "linear-gradient(135deg, #f7f7fb 60%, #e8e9fb 100%)",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Brand mark: two stacked artifact cards (mirrors the app wordmark). */}
        <div style={{ display: "flex", position: "relative", width: 56, height: 56 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: INDIGO,
              opacity: 0.35,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: INDIGO,
            }}
          />
        </div>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: INK }}>
          Artifact Hub
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {kind ? (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              backgroundColor: "#e3e4f9",
              color: INDIGO,
              borderRadius: 999,
              padding: "8px 24px",
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            {kind}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 700,
            color: INK,
            lineHeight: 1.15,
          }}
        >
          {title.length > 70 ? `${title.slice(0, 70)}…` : title}
        </div>
        {description ? (
          <div style={{ display: "flex", fontSize: 32, color: MUTED, lineHeight: 1.4 }}>
            {description.length > 120 ? `${description.slice(0, 120)}…` : description}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", fontSize: 28, color: MUTED }}>
        Shared for review · open to see the full artifact and leave feedback
      </div>
    </div>,
    size,
  );
}
