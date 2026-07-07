import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Post-deploy smoke check (PLAN §6 E2E; becomes the Phase-5 gate). Exercises the
// full MCP loop over real HTTPS against a configurable base URL: initialize →
// tools/list → search → authenticated publish → share → fetch share URL → revoke,
// then cleans up. Secrets are referenced only by env-var name and are NEVER printed.
//
// Env (via dotenv / the shell):
//   SMOKE_BASE_URL   base URL of the target deployment (falls back to APP_BASE_URL,
//                    then http://localhost:3000)
//   ADMIN_API_TOKEN  bearer for the authenticated write steps
//
// Run: `pnpm smoke`

const BASE_URL = process.env.SMOKE_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.ADMIN_API_TOKEN;
const EXPECTED_TOOLS = [
  "publish_artifact",
  "search_artifacts",
  "get_artifact",
  "create_share_link",
  "revoke_share_link",
  "get_feedback",
  "add_comment",
  "hub_stats",
];

let failures = 0;
function step(name: string, ok: boolean, detail = ""): boolean {
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

function structured<T>(res: unknown): T | undefined {
  const r = res as { isError?: boolean; structuredContent?: unknown };
  return r.isError ? undefined : (r.structuredContent as T);
}

async function main(): Promise<void> {
  if (!TOKEN) {
    // Reference the secret by name only — never echo its value.
    console.error("ADMIN_API_TOKEN is not set in the environment. Aborting.");
    process.exit(2);
  }

  const endpoint = new URL("/api/mcp", BASE_URL);
  console.log(`Smoke target: ${endpoint.origin}\n`);

  // §8: gallery loads. The browse page is the front door — assert it serves HTML.
  const gallery = await fetch(new URL("/", BASE_URL));
  const galleryBody = gallery.ok ? await gallery.text() : "";
  step(
    "gallery loads",
    gallery.ok && galleryBody.includes("Artifact Hub"),
    gallery.ok ? "" : `status ${gallery.status}`,
  );

  const client = new Client({ name: "artifact-hub-smoke", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });

  await client.connect(transport);
  step("initialize", Boolean(client.getInstructions()), "handshake + server instructions");

  const { tools } = await client.listTools();
  const present = new Set(tools.map((t) => t.name));
  const missing = EXPECTED_TOOLS.filter((n) => !present.has(n));
  step(
    "tools/list",
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : `${tools.length} tools`,
  );

  step(
    "search_artifacts",
    !(await client.callTool({ name: "search_artifacts", arguments: { limit: 3 } })).isError,
  );

  // §8: publish via the REST API (bearer-authenticated write). Titled/tagged as
  // smoke noise so `pnpm db:seed --reset` can sweep any leftover if cleanup fails.
  const stamp = new Date().toISOString();
  const shareTitle = `Smoke test ${stamp}`;
  const publishRes = await fetch(new URL("/api/v1/artifacts", BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      content: `<!doctype html><meta charset="utf-8"><h1>${shareTitle}</h1>`,
      filename: "smoke.html",
      title: shareTitle,
      tags: ["smoke-test"],
    }),
  });
  const artifactId = publishRes.ok ? ((await publishRes.json()) as { id?: string }).id : undefined;
  step(
    "publish via REST API",
    Boolean(artifactId),
    artifactId ? `id ${artifactId}` : `status ${publishRes.status}`,
  );

  // §8: artifact page renders — the detail page must serve the published title.
  if (artifactId) {
    const page = await fetch(new URL(`/a/${artifactId}`, BASE_URL));
    const pageBody = page.ok ? await page.text() : "";
    step(
      "artifact page renders",
      page.ok && pageBody.includes(shareTitle),
      page.ok ? "" : `status ${page.status}`,
    );
  }

  let shareUrl: string | undefined;
  let linkId: string | undefined;
  if (artifactId) {
    const shared = await client.callTool({
      name: "create_share_link",
      arguments: { id: artifactId, duration: "72h" },
    });
    const link = structured<{ url: string; linkId: string }>(shared);
    shareUrl = link?.url;
    linkId = link?.linkId;
    step(
      "create_share_link",
      Boolean(shareUrl && linkId),
      link?.linkId ? `link ${link.linkId}` : "",
    );
  }

  if (shareUrl) {
    const res = await fetch(shareUrl, { redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    // Hard assertion (Phase 3): the viewer must actually render THIS artifact, so we
    // require both a 200 and the artifact's unique title in the HTML. Grepping the
    // specific title (not just the status) means a generic 200 error/placeholder
    // page can't make this pass.
    step(
      "fetch share URL",
      res.status === 200 && body.includes(shareTitle),
      res.status === 200 ? "rendered shared artifact" : `status ${res.status}`,
    );
  }

  if (linkId) {
    step(
      "revoke_share_link",
      !(await client.callTool({ name: "revoke_share_link", arguments: { linkId } })).isError,
    );
  }

  // Best-effort cleanup so repeated prod runs don't accumulate smoke artifacts.
  if (artifactId) {
    const del = await fetch(new URL(`/api/v1/artifacts/${artifactId}`, BASE_URL), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    step("cleanup (delete smoke artifact)", del.ok || del.status === 404, `status ${del.status}`);
  }

  await client.close();
  console.log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED — ${failures} step(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Smoke run crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
