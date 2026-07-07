import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

// Load every JSON fixture in a subdirectory, sorted for a stable scorecard order.
export function loadFixtures<T>(subdir: string): T[] {
  const dir = join(FIXTURES_DIR, subdir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as T);
}
