import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/session";

// The ?next= param comes off the URL/form untrusted; anything but a same-site
// path must fall back to "/" or /unlock becomes an open redirect.
describe("safeNextPath", () => {
  it("passes through same-site paths", () => {
    expect(safeNextPath("/a/abc123")).toBe("/a/abc123");
    expect(safeNextPath("/publish")).toBe("/publish");
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects absolute URLs, protocol-relative URLs, and junk", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
