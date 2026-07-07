import { describe, expect, it } from "vitest";
import { barChartPng, simplePdf } from "@/db/seed-content";

describe("seed-content generators", () => {
  it("emits a valid PNG signature and IEND", () => {
    const png = barChartPng([10, 20, 30]);
    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    // Ends with the IEND chunk.
    expect(new TextDecoder().decode(png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  });

  it("is deterministic (byte-identical across runs → idempotent seed)", () => {
    expect(barChartPng([1, 2, 3])).toEqual(barChartPng([1, 2, 3]));
    expect(simplePdf(["a", "b"])).toEqual(simplePdf(["a", "b"]));
  });

  it("emits a valid PDF header, xref, and EOF", () => {
    const pdf = simplePdf(["Hello", "World"]);
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("\nxref\n");
    expect(text).toContain("startxref\n");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("escapes PDF special characters so the content stream stays valid", () => {
    const text = new TextDecoder().decode(simplePdf(["a (b) \\ c"]));
    expect(text).toContain("(a \\(b\\) \\\\ c) Tj");
  });
});
