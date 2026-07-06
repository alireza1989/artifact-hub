import { describe, expect, it } from "vitest";
import { AuthRequiredError, assertAuthed } from "@/mcp/auth";

describe("assertAuthed", () => {
  it("passes when the request is authenticated", () => {
    expect(() => assertAuthed({ isAuthed: true })).not.toThrow();
  });

  it("throws a recoverable AuthRequiredError when unauthenticated", () => {
    try {
      assertAuthed({ isAuthed: false });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthRequiredError);
      expect((error as AuthRequiredError).code).toBe("auth_required");
      expect((error as AuthRequiredError).message).toMatch(/bearer token/i);
    }
  });
});
