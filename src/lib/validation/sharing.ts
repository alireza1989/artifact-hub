import { z } from "zod";
import { artifactIdSchema } from "./artifact";

// Share-link durations offered (PLAN §3.3). The enum is the single source of truth
// for both the MCP create_share_link tool and the Phase-3 UI.
export const SHARE_DURATIONS = ["1h", "24h", "72h", "7d", "30d"] as const;
export type ShareDuration = (typeof SHARE_DURATIONS)[number];
export const shareDurationSchema = z.enum(SHARE_DURATIONS);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Duration string → milliseconds. Kept next to the enum so the two never drift.
export const DURATION_MS: Record<ShareDuration, number> = {
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
  "72h": 72 * HOUR_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

// Human-readable expiry per duration, for tool/UI copy ("expires in 3 days").
export const DURATION_LABEL: Record<ShareDuration, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "72h": "3 days",
  "7d": "7 days",
  "30d": "30 days",
};

export const createShareLinkInputSchema = z.object({
  id: artifactIdSchema,
  duration: shareDurationSchema,
});

// A share token is `<linkId>.<signature>` (PLAN §3.3). Bounded, permissive check
// so malformed tokens fail fast at the boundary before any DB round-trip.
export const shareTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,128}$/, "Malformed share token");
