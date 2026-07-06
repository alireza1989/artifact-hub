// Storage adapter boundary (PLAN §3). core/ depends only on this interface, never
// on a concrete driver, so the Vercel Blob backend can be swapped (or faked in
// tests) without touching business logic. `url` is an opaque handle: content is
// always re-served through /raw/[id] under our CSP, never linked to clients.

export type PutResult = { url: string };

export interface Storage {
  /** Store bytes under `pathname` (a random suffix is added to avoid collisions). */
  put(pathname: string, body: Uint8Array, contentType: string): Promise<PutResult>;
  /** Read the bytes back for /raw/[id] serving. */
  read(url: string): Promise<Uint8Array>;
  /** Remove the blob (best-effort; missing blobs do not throw). */
  delete(url: string): Promise<void>;
}
