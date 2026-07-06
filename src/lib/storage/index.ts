// lib/storage — blob storage adapter (PLAN §3). core/ consumes the `Storage`
// interface; the concrete Vercel Blob driver is the default, tests inject a fake.
import type { Storage } from "./types";
import { VercelBlobStorage } from "./vercel-blob";

export { InMemoryStorage } from "./memory";
export type { PutResult, Storage } from "./types";
export { VercelBlobStorage } from "./vercel-blob";

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (!storage) storage = new VercelBlobStorage();
  return storage;
}

// Test seam: integration tests inject an in-memory backend so route handlers that
// call getStorage() internally never touch the network. Not used in production.
export function setStorageForTesting(fake: Storage): void {
  storage = fake;
}
