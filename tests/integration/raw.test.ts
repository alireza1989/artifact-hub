import { describe, expect, it } from "vitest";
import { GET as raw } from "@/app/raw/[id]/route";
import { createArtifact } from "@/core/artifacts";
import { createShareLink, revokeShareLink } from "@/core/sharing";

const enc = (s: string) => new TextEncoder().encode(s);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const seed = (content: string, filename: string) =>
  createArtifact({ bytes: enc(content), filename, source: "api" });

// /raw is team-gated (decision 2026-07-07); most tests authenticate the way the
// gallery does — the session cookie the browser attaches to iframe/img requests.
const sessionCookie = { cookie: `ah_session=${process.env.ADMIN_API_TOKEN}` };
const get = (id: string, query = "", headers: Record<string, string> = sessionCookie) =>
  raw(new Request(`http://localhost/raw/${id}${query}`, { headers }), ctx(id));

const shareTokenFor = (artifactId: string) => createShareLink(artifactId, "1h");

describe("GET /raw/:id security headers", () => {
  it("serves HTML with a script-permitting sandbox but no network access", async () => {
    const a = await seed("<!doctype html><html></html>", "p.html");
    const res = await get(a.id);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
  });

  it("serves SVG sandboxed WITHOUT allowing scripts", async () => {
    const a = await seed('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "i.svg");
    const res = await get(a.id);

    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-scripts");
  });

  it("supports a download disposition and 404s unknown ids", async () => {
    const a = await seed("name,age\nA,1", "d.csv");
    const dl = await get(a.id, "?download");
    expect(dl.headers.get("content-disposition")).toBe("attachment");

    const missing = await get("nope");
    expect(missing.status).toBe(404);
  });
});

describe("GET /raw/:id team gating", () => {
  it("401s without any credential, and with a wrong session cookie", async () => {
    const a = await seed("secret", "s.txt");
    expect((await get(a.id, "", {})).status).toBe(401);
    expect((await get(a.id, "", { cookie: "ah_session=wrong-token-000000" })).status).toBe(401);
  });

  it("accepts the admin bearer token", async () => {
    const a = await seed("via api", "b.txt");
    const res = await get(a.id, "", {
      authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("via api");
  });

  it("accepts a share token that grants exactly this artifact", async () => {
    const a = await seed("shared bytes", "share.txt");
    const { token } = await shareTokenFor(a.id);
    const res = await get(a.id, `?st=${encodeURIComponent(token)}`, {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("shared bytes");
  });

  it("rejects a share token for a DIFFERENT artifact", async () => {
    const a = await seed("target", "a.txt");
    const other = await seed("other", "b.txt");
    const { token } = await shareTokenFor(other.id);
    expect((await get(a.id, `?st=${encodeURIComponent(token)}`, {})).status).toBe(401);
  });

  it("rejects revoked and malformed share tokens", async () => {
    const a = await seed("gone", "g.txt");
    const { token, linkId } = await shareTokenFor(a.id);
    await revokeShareLink(linkId);
    expect((await get(a.id, `?st=${encodeURIComponent(token)}`, {})).status).toBe(401);
    expect((await get(a.id, "?st=not-a-token", {})).status).toBe(401);
  });
});
