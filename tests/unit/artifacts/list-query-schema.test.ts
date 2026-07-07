import { describe, expect, it } from "vitest";
import { listQuerySchema } from "@/lib/validation";

// Regression for the Phase-1→6 prod search crash (fixed 2026-07-07): the gallery
// search box is a native GET form, so every submit sends ALL its fields —
// `/?q=word&kind=` is the real shape of a UI search. Blank strings at this
// boundary mean "not provided" and must never throw.

describe("listQuerySchema blank-field tolerance (form-shaped input)", () => {
  it("accepts the exact shape the gallery form submits (kind left on All types)", () => {
    const parsed = listQuerySchema.parse({ q: "report", kind: "" });
    expect(parsed.q).toBe("report");
    expect(parsed.kind).toBeUndefined();
  });

  it("accepts an empty q with a chosen kind", () => {
    const parsed = listQuerySchema.parse({ q: "", kind: "html" });
    expect(parsed.q).toBeUndefined();
    expect(parsed.kind).toBe("html");
  });

  it("accepts everything blank (bare Search click) and applies defaults", () => {
    const parsed = listQuerySchema.parse({
      q: "",
      kind: "",
      tags: "",
      since: "",
      sort: "",
      limit: "",
      offset: "",
    });
    expect(parsed).toMatchObject({ sort: "recent", limit: 24, offset: 0 });
    expect(parsed.q).toBeUndefined();
    expect(parsed.kind).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
    expect(parsed.since).toBeUndefined();
  });

  it("whitespace-only counts as blank", () => {
    const parsed = listQuerySchema.parse({ q: "   " });
    expect(parsed.q).toBeUndefined();
  });

  it("still rejects genuinely invalid values", () => {
    expect(() => listQuerySchema.parse({ kind: "executable" })).toThrow();
    expect(() => listQuerySchema.parse({ limit: "999" })).toThrow();
    expect(() => listQuerySchema.parse({ since: "not-a-date" })).toThrow();
  });
});
