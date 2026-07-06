import { describe, expect, it } from "vitest";
import { GET as raw } from "@/app/raw/[id]/route";
import { createArtifact } from "@/core/artifacts";

const enc = (s: string) => new TextEncoder().encode(s);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const seed = (content: string, filename: string) =>
  createArtifact({ bytes: enc(content), filename, source: "api" });

describe("GET /raw/:id security headers", () => {
  it("serves HTML with a script-permitting sandbox but no network access", async () => {
    const a = await seed("<!doctype html><html></html>", "p.html");
    const res = await raw(new Request(`http://localhost/raw/${a.id}`), ctx(a.id));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
  });

  it("serves SVG sandboxed WITHOUT allowing scripts", async () => {
    const a = await seed('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "i.svg");
    const res = await raw(new Request(`http://localhost/raw/${a.id}`), ctx(a.id));

    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-scripts");
  });

  it("supports a download disposition and 404s unknown ids", async () => {
    const a = await seed("name,age\nA,1", "d.csv");
    const dl = await raw(new Request(`http://localhost/raw/${a.id}?download`), ctx(a.id));
    expect(dl.headers.get("content-disposition")).toBe("attachment");

    const missing = await raw(new Request("http://localhost/raw/nope"), ctx("nope"));
    expect(missing.status).toBe(404);
  });
});
