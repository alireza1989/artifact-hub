import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import type { Artifact } from "@/db/schema";
import { artifacts } from "@/db/schema";
import type { Storage } from "@/lib/storage";
import { getStorage } from "@/lib/storage";
import { ArtifactNotFoundError } from "./errors";

export async function getArtifact(id: string): Promise<Artifact> {
  const [row] = await getDb().select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  if (!row) throw new ArtifactNotFoundError(id);
  return row;
}

export type ArtifactContent = { artifact: Artifact; bytes: Uint8Array };

// Fetch metadata + raw bytes for /raw/[id] serving. Bytes come from storage, not
// the DB, so this stays a two-step read.
export async function getArtifactContent(
  id: string,
  storage: Storage = getStorage(),
): Promise<ArtifactContent> {
  const artifact = await getArtifact(id);
  const bytes = await storage.read(artifact.blobUrl);
  return { artifact, bytes };
}
