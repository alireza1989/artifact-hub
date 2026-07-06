import { del, get, put } from "@vercel/blob";
import { getEnv } from "@/lib/env";
import type { PutResult, Storage } from "./types";

// Vercel Blob backend, private store. Blobs require the token to read and are never
// linked to clients — /raw/[id] fetches the bytes server-side and re-serves them
// under our security headers (CLAUDE.md invariant). Private access hardens that: a
// leaked blob URL is useless without the token.
export class VercelBlobStorage implements Storage {
  async put(pathname: string, body: Uint8Array, contentType: string): Promise<PutResult> {
    const { url } = await put(pathname, Buffer.from(body), {
      access: "private",
      addRandomSuffix: true,
      contentType,
      token: getEnv().BLOB_READ_WRITE_TOKEN,
    });
    return { url };
  }

  async read(url: string): Promise<Uint8Array> {
    // Private blobs aren't publicly fetchable — read them through the SDK with the
    // token (returns a stream on 200).
    const result = await get(url, { access: "private", token: getEnv().BLOB_READ_WRITE_TOKEN });
    if (result?.statusCode !== 200) {
      throw new Error(`Blob read failed for ${url}`);
    }
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async delete(url: string): Promise<void> {
    await del(url, { token: getEnv().BLOB_READ_WRITE_TOKEN });
  }
}
