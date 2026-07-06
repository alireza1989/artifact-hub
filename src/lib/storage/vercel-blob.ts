import { del, put } from "@vercel/blob";
import { getEnv } from "@/lib/env";
import type { PutResult, Storage } from "./types";

// Vercel Blob backend. Blobs are public+random-suffixed (unguessable) but never
// linked directly — /raw/[id] fetches and re-serves them under our security
// headers, so the public URL is an internal implementation detail.
export class VercelBlobStorage implements Storage {
  async put(pathname: string, body: Uint8Array, contentType: string): Promise<PutResult> {
    const { url } = await put(pathname, Buffer.from(body), {
      access: "public",
      addRandomSuffix: true,
      contentType,
      token: getEnv().BLOB_READ_WRITE_TOKEN,
    });
    return { url };
  }

  async read(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Blob read failed (${res.status}) for ${url}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(url: string): Promise<void> {
    await del(url, { token: getEnv().BLOB_READ_WRITE_TOKEN });
  }
}
