import { nanoid } from "nanoid";
import { getArtifact } from "@/core/artifacts";
import { getDb } from "@/db";
import { shareLinks } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { DURATION_LABEL, DURATION_MS, type ShareDuration } from "@/lib/validation";
import { hashToken, signToken } from "./token";

export type CreatedShareLink = {
  linkId: string;
  token: string;
  url: string;
  expiresAt: Date;
  expiresInHuman: string;
};

// Create a time-limited, revocable share link (PLAN §3.3). Asserts the artifact
// exists first (surfaces ArtifactNotFoundError's recovery text). Stores only the
// token hash; returns the one-time token embedded in the share URL.
export async function createShareLink(
  artifactId: string,
  duration: ShareDuration,
): Promise<CreatedShareLink> {
  await getArtifact(artifactId);

  const linkId = nanoid();
  const expiresAt = new Date(Date.now() + DURATION_MS[duration]);
  const token = signToken(linkId, expiresAt.getTime());

  await getDb()
    .insert(shareLinks)
    .values({
      id: linkId,
      artifactId,
      tokenHash: hashToken(token),
      expiresAt,
    });

  const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
  return {
    linkId,
    token,
    url: `${base}/share/${token}`,
    expiresAt,
    expiresInHuman: DURATION_LABEL[duration],
  };
}
