import { describe, expect, it } from "vitest";
import {
  ArtifactNotFoundError,
  createArtifact,
  deleteArtifact,
  getArtifact,
  getArtifactContent,
  listArtifacts,
} from "@/core/artifacts";
import { InMemoryStorage } from "@/lib/storage";
import { listQuerySchema, publishMetadataSchema } from "@/lib/validation";

const storage = new InMemoryStorage();
const enc = (s: string) => new TextEncoder().encode(s);

// Mirror the adapter boundary: metadata is validated/normalized before core sees it.
function publish(content: string, filename: string, metadata?: Record<string, unknown>) {
  return createArtifact(
    {
      bytes: enc(content),
      filename,
      source: "api",
      metadata: metadata ? publishMetadataSchema.parse(metadata) : undefined,
    },
    storage,
  );
}

const query = (partial: Record<string, unknown> = {}) => listQuerySchema.parse(partial);

describe("core/artifacts lifecycle", () => {
  it("publishes, sniffs, stores, and reads back an HTML artifact", async () => {
    const created = await publish("<!doctype html><html><body>Hi</body></html>", "page.html", {
      title: "My Page",
      tags: ["Design", "design", "  "],
    });

    expect(created.kind).toBe("html");
    expect(created.contentType).toBe("text/html");
    expect(created.title).toBe("My Page");
    expect(created.tags).toEqual(["design"]); // normalized + de-duped

    const fetched = await getArtifact(created.id);
    expect(fetched.id).toBe(created.id);

    const content = await getArtifactContent(created.id, storage);
    expect(new TextDecoder().decode(content.bytes)).toContain("Hi");
  });

  it("derives a title from the filename when none is given", async () => {
    const created = await publish('{"a":1}', "quarterly-report.json");
    expect(created.kind).toBe("json");
    expect(created.title).toBe("quarterly-report");
  });

  it("throws ArtifactNotFoundError for unknown ids", async () => {
    await expect(getArtifact("does-not-exist")).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it("deletes an artifact", async () => {
    const created = await publish("hello", "note.txt");
    await deleteArtifact(created.id, storage);
    await expect(getArtifact(created.id)).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});

describe("core/artifacts search + filter", () => {
  it("full-text searches title, description, and tags", async () => {
    await publish("<html></html>", "a.html", { title: "Onboarding flow diagram", tags: ["ux"] });
    await publish("<html></html>", "b.html", { title: "Pricing page", tags: ["marketing"] });

    const result = await listArtifacts(query({ q: "onboarding" }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Onboarding flow diagram");
  });

  it("filters by kind and by tag overlap", async () => {
    await publish("<html></html>", "a.html", { title: "H", tags: ["shared"] });
    await publish('{"x":1}', "b.json", { title: "J", tags: ["shared"] });

    expect((await listArtifacts(query({ kind: "json" }))).items).toHaveLength(1);
    expect((await listArtifacts(query({ tags: "shared" }))).total).toBe(2);
    expect((await listArtifacts(query({ tags: "missing" }))).total).toBe(0);
  });

  it("paginates with an accurate total", async () => {
    for (let i = 0; i < 5; i++) await publish("hello", `n${i}.txt`, { title: `Note ${i}` });

    const page = await listArtifacts(query({ limit: 2, offset: 0 }));
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it("includes a comment count (zero when none)", async () => {
    const created = await publish("hello", "n.txt");
    const result = await listArtifacts(query());
    expect(result.items.find((a) => a.id === created.id)?.commentCount).toBe(0);
  });
});
