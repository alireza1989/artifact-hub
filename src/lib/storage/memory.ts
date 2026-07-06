import type { PutResult, Storage } from "./types";

// In-memory Storage for integration tests: no network, deterministic urls.
// Not used in production paths.
export class InMemoryStorage implements Storage {
  private readonly blobs = new Map<string, Uint8Array>();
  private counter = 0;

  put(pathname: string, body: Uint8Array, _contentType: string): Promise<PutResult> {
    const url = `memory://${pathname}-${this.counter++}`;
    this.blobs.set(url, body);
    return Promise.resolve({ url });
  }

  read(url: string): Promise<Uint8Array> {
    const body = this.blobs.get(url);
    if (!body) throw new Error(`InMemoryStorage: no blob at ${url}`);
    return Promise.resolve(body);
  }

  delete(url: string): Promise<void> {
    this.blobs.delete(url);
    return Promise.resolve();
  }
}
