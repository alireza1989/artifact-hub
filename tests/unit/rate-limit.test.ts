import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const key = `t-${Math.random()}`;
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(true);
    expect(rateLimit(key, 3, 60_000)).toBe(false);
  });

  it("starts a fresh window once the previous one has elapsed", () => {
    const key = `t-${Math.random()}`;
    // A non-positive window is already expired, so each call opens a new window.
    expect(rateLimit(key, 1, 0)).toBe(true);
    expect(rateLimit(key, 1, 0)).toBe(true);
  });

  it("keys are independent", () => {
    expect(rateLimit(`a-${Math.random()}`, 1, 60_000)).toBe(true);
    expect(rateLimit(`b-${Math.random()}`, 1, 60_000)).toBe(true);
  });
});
