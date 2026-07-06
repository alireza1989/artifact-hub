import { describe, expect, it } from "vitest";
import { sniffArtifact } from "../../../src/core/artifacts/sniff";

const enc = (s: string) => new TextEncoder().encode(s);

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
]);

describe("sniffArtifact — magic bytes (tier 1)", () => {
  it("detects PNG regardless of a misleading .txt filename", async () => {
    expect(await sniffArtifact({ bytes: PNG, filename: "logo.txt" })).toEqual({
      contentType: "image/png",
      kind: "image",
    });
  });

  it("detects GIF", async () => {
    expect(await sniffArtifact({ bytes: enc("GIF89a\x00\x00") })).toMatchObject({ kind: "image" });
  });

  it("detects PDF", async () => {
    expect(await sniffArtifact({ bytes: enc("%PDF-1.7\n1 0 obj\n") })).toEqual({
      contentType: "application/pdf",
      kind: "pdf",
    });
  });
});

describe("sniffArtifact — text classifier (tier 2)", () => {
  it("classifies HTML by doctype", async () => {
    expect(
      await sniffArtifact({ bytes: enc("<!DOCTYPE html><html><body>hi</body></html>") }),
    ).toEqual({ contentType: "text/html", kind: "html" });
  });

  it("classifies HTML with leading whitespace and no doctype", async () => {
    expect(await sniffArtifact({ bytes: enc('\n\n  <html lang="en"></html>') })).toMatchObject({
      kind: "html",
    });
  });

  it("classifies SVG before HTML (more specific root)", async () => {
    expect(
      await sniffArtifact({ bytes: enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }),
    ).toEqual({ contentType: "image/svg+xml", kind: "svg" });
  });

  it("classifies SVG carrying an XML declaration", async () => {
    expect(
      await sniffArtifact({
        bytes: enc('<?xml version="1.0"?>\n<svg><script>alert(1)</script></svg>'),
      }),
    ).toMatchObject({ kind: "svg" });
  });

  it("classifies JSON object content", async () => {
    expect(await sniffArtifact({ bytes: enc('{"title":"x","n":1}') })).toEqual({
      contentType: "application/json",
      kind: "json",
    });
  });

  it("falls back to text when a .json file does not parse", async () => {
    expect(await sniffArtifact({ bytes: enc("not: json"), filename: "data.json" })).toEqual({
      contentType: "text/plain",
      kind: "text",
    });
  });

  it("classifies Markdown by extension", async () => {
    expect(await sniffArtifact({ bytes: enc("# Heading\n\ntext"), filename: "README.md" })).toEqual(
      {
        contentType: "text/markdown",
        kind: "markdown",
      },
    );
  });

  it("classifies CSV by extension", async () => {
    expect(await sniffArtifact({ bytes: enc("a,b\n1,2"), filename: "rows.csv" })).toEqual({
      contentType: "text/csv",
      kind: "csv",
    });
  });

  it("classifies CSV by content heuristic without an extension", async () => {
    expect(await sniffArtifact({ bytes: enc("name,age,city\nA,1,X\nB,2,Y") })).toMatchObject({
      kind: "csv",
    });
  });

  it("classifies code files as text", async () => {
    expect(await sniffArtifact({ bytes: enc("export const x = 1;"), filename: "a.ts" })).toEqual({
      contentType: "text/plain",
      kind: "text",
    });
  });

  it("honors a declared markdown type when nothing else matches", async () => {
    expect(
      await sniffArtifact({ bytes: enc("just prose"), declaredContentType: "text/markdown" }),
    ).toEqual({ contentType: "text/markdown", kind: "markdown" });
  });

  it("defaults undetectable text to plain text", async () => {
    expect(await sniffArtifact({ bytes: enc("hello world") })).toEqual({
      contentType: "text/plain",
      kind: "text",
    });
  });

  it("treats undecodable bytes with NULs as other", async () => {
    expect(await sniffArtifact({ bytes: new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]) })).toEqual({
      contentType: "application/octet-stream",
      kind: "other",
    });
  });
});
