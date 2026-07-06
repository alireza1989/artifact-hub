import { describe, expect, it } from "vitest";
import { GET as getById, DELETE as remove } from "@/app/api/v1/artifacts/[id]/route";
import { GET as list, POST as publish } from "@/app/api/v1/artifacts/route";

const BASE = "http://localhost/api/v1/artifacts";
const authHeaders = { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` };

function publishJson(body: unknown, auth = true): Request {
  return new Request(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? authHeaders : {}) },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/v1/artifacts", () => {
  it("rejects unauthenticated writes with 401", async () => {
    const res = await publish(publishJson({ content: "<html></html>" }, false));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("publishes inline HTML content", async () => {
    const res = await publish(
      publishJson({ content: "<!doctype html><html></html>", filename: "p.html", title: "Home" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ kind: "html", contentType: "text/html", title: "Home" });
  });

  it("rejects empty content with 400", async () => {
    const res = await publish(publishJson({ content: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("empty_content");
  });
});

describe("GET /api/v1/artifacts", () => {
  it("lists and searches published artifacts", async () => {
    await publish(publishJson({ content: "<html></html>", title: "Roadmap deck" }));
    await publish(publishJson({ content: "<html></html>", title: "Budget sheet" }));

    const all = await list(new Request(BASE));
    expect((await all.json()).total).toBe(2);

    const search = await list(new Request(`${BASE}?q=roadmap`));
    const found = await search.json();
    expect(found.items).toHaveLength(1);
    expect(found.items[0].title).toBe("Roadmap deck");
  });
});

describe("GET/DELETE /api/v1/artifacts/:id", () => {
  it("fetches by id and 404s on unknown ids", async () => {
    const created = await (await publish(publishJson({ content: "hi", title: "Note" }))).json();

    const ok = await getById(new Request(`${BASE}/${created.id}`), ctx(created.id));
    expect(ok.status).toBe(200);

    const missing = await getById(new Request(`${BASE}/nope`), ctx("nope"));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("artifact_not_found");
  });

  it("deletes with auth (401 without)", async () => {
    const created = await (await publish(publishJson({ content: "hi", title: "Temp" }))).json();

    const noAuth = await remove(
      new Request(`${BASE}/${created.id}`, { method: "DELETE" }),
      ctx(created.id),
    );
    expect(noAuth.status).toBe(401);

    const del = await remove(
      new Request(`${BASE}/${created.id}`, { method: "DELETE", headers: authHeaders }),
      ctx(created.id),
    );
    expect(del.status).toBe(204);

    const after = await getById(new Request(`${BASE}/${created.id}`), ctx(created.id));
    expect(after.status).toBe(404);
  });
});
