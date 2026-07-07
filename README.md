# Artifact Hub

A platform for publishing, browsing, reviewing, and sharing AI-generated content
(HTML, images, PDFs, Markdown, CSVs, code, and more). One deployable Next.js app
exposing the **same capabilities three ways** — a web UI, a REST API, and a remote
**MCP server** — over a shared, framework-free core. LLM features (Claude Haiku)
pre-fill metadata on publish and synthesize scattered review comments into
consensus / disagreement / action items.

Live demo: <https://artifact-hub-murex.vercel.app>

See [`PLAN.md`](./PLAN.md) for scope, architecture, and the decision log, and
[`CLAUDE.md`](./CLAUDE.md) for the development operating manual.

## What it does

- **Publish** any file (web upload, REST, or conversationally via MCP). Type is
  sniffed server-side from magic bytes; missing title/description/tags are filled
  by AI and shown as editable "suggested" values.
- **Browse** a visual gallery with full-text search and tag/type filters.
- **Preview** every kind safely — HTML/SVG in locked-down sandboxed iframes,
  images inline, PDFs in the native viewer, Markdown sanitized, CSV as a table,
  JSON/code in read-only viewers.
- **Share** via revocable, time-limited, HMAC-signed links that work for people
  outside the team. External reviewers can comment without an account.
- **Review** with comments; artifacts with ≥2 comments get an AI synthesis card
  whose bullets link back to the comments they cite.
- **MCP** so Claude Desktop and other MCP clients can publish, search, share, and
  read/leave feedback in natural conversation.

## Architecture

```
Web UI ──┐
REST ────┼──► core/ (artifacts, sharing, feedback, ai) ──► db/  (Drizzle → Postgres/Neon)
MCP  ────┘                                            └──► lib/storage (Vercel Blob)
                                                      └──► lib/ai (Anthropic + telemetry)
```

All business logic lives in **framework-free `core/` modules** consumed by three
thin adapters (UI server components/actions, REST routes, MCP tools). Validation
schemas in `lib/validation` are shared across all three. `core/` never imports
`app/` — that boundary keeps the surfaces honest and the logic unit-testable.

```
src/
  app/     Next.js App Router — (gallery) browse/detail/publish, share/[token],
           raw/[id] sandboxed serving, api/{mcp,v1}
  core/    business logic: artifacts, sharing, feedback, ai
  db/      Drizzle schema + migrations + demo seed
  lib/     ai client/config, storage adapter, shared Zod validation, env, auth
  mcp/     MCP tool definitions (thin wrappers over core/)
tests/     unit · integration (real Postgres) · evals (real Haiku)
scripts/   smoke.ts — post-deploy end-to-end check
```

## Stack

- Node 24 LTS · TypeScript strict · pnpm
- Next.js 16 (App Router, Turbopack) · Tailwind CSS v4 · shadcn/ui
- Drizzle ORM · Postgres (Neon) · Vercel Blob (private store)
- Zod v4 · Biome (lint+format) · Vitest · Lefthook · GitHub Actions
- MCP (stateless Streamable HTTP, `@modelcontextprotocol/sdk`) · Anthropic SDK
  (Claude Haiku — model id centralized in `src/lib/ai/config.ts`)

## Getting started (local)

Prerequisites: Node 24 (`nvm use`), pnpm (`corepack enable pnpm`), and a Postgres
you can point at (the repo ships a `docker-compose.yml`).

```bash
nvm use
corepack enable pnpm
pnpm install
cp .env.example .env            # fill in values (see below)

docker compose up -d            # local Postgres
pnpm db:migrate                 # apply migrations
pnpm db:seed                    # optional: load demo artifacts

pnpm dev                        # http://localhost:3000
```

Writes on the web UI (publish, delete, share management) are gated by a team
token: visit `/unlock` and enter your `ADMIN_API_TOKEN` once (stored as an
httpOnly cookie). Browsing and commenting need no token.

## Environment variables

`src/lib/env.ts` validates all of these with Zod at first use and fails fast with
a clear message if any are missing or malformed.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. A `*.neon.tech` host selects the Neon serverless driver; anything else uses postgres.js (local docker). |
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob (private store) — artifact binaries. |
| `ANTHROPIC_API_KEY` | yes | Claude Haiku for metadata generation + feedback synthesis. |
| `SHARE_LINK_SECRET` | yes | ≥32 bytes; HMAC key for share tokens. |
| `ADMIN_API_TOKEN` | yes | ≥16 chars; bearer for REST/MCP writes and the web token-gate. |
| `APP_BASE_URL` | yes | Absolute base URL used to build share links. |
| `AI_DAILY_CALL_BUDGET` | no (default 500) | Per-feature daily LLM call ceiling; exceeding it falls back deterministically. |

## Connecting a reviewer via MCP

The MCP server is mounted at `POST /api/mcp` (stateless Streamable HTTP). Read
tools (`search_artifacts`, `get_artifact`, `get_feedback`, `add_comment`,
`hub_stats`) are open; write tools (`publish_artifact`, `create_share_link`,
`revoke_share_link`) require the bearer token. There are two ways to connect:

**1. Remote connector (Claude Desktop → Settings → Connectors).** Add a remote
MCP server with URL `https://<your-deployment>/api/mcp` and header
`Authorization: Bearer <ADMIN_API_TOKEN>`.

**2. stdio clients via `mcp-remote`.** For clients that only speak stdio, bridge
with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "artifact-hub": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-deployment>/api/mcp",
        "--header",
        "Authorization: Bearer ${ARTIFACT_HUB_TOKEN}"
      ],
      "env": { "ARTIFACT_HUB_TOKEN": "<ADMIN_API_TOKEN>" }
    }
  }
}
```

Once connected, a reviewer flow reads naturally: *"publish this HTML → share it
for 72 hours → any feedback yet?"* maps to `publish_artifact` → `create_share_link`
→ `get_feedback`. Every tool error names the failure **and** the recovery step.

## Demo data & resetting production

`pnpm db:seed` loads ~8 realistic artifacts across every preview kind (an HTML
mockup, a chart PNG, an SVG flow diagram, a PDF board report, a Markdown guide, a
Python script, a JSON config, a sales CSV), with tags, review comments (several
sets of 3+ so the synthesis card appears), and one active 7-day share link. It
prints the share URL — grab it there, the token is stored hash-only.

The seed is **idempotent**: every demo artifact has a stable id, so re-running
replaces the demo set rather than duplicating it. Anything you published by hand
is left untouched.

```bash
pnpm db:seed            # upsert the demo set (leaves other artifacts alone)
pnpm db:seed --reset    # also delete post-deploy smoke-test leftovers, then seed
```

Use `--reset` to return production to a clean demo state after the smoke script
has left `Smoke test …` artifacts behind. It only removes smoke-test rows and the
demo set — never other artifacts.

## Testing & quality gates

```bash
pnpm check    # typecheck + Biome lint/format  (pre-commit gate)
pnpm test     # Vitest: unit + integration (integration needs Postgres)
pnpm build    # production build
pnpm eval     # LLM eval harness against golden sets (needs ANTHROPIC_API_KEY)
pnpm smoke    # end-to-end check against a live deployment (needs ADMIN_API_TOKEN)
```

- **Unit** tests cover `core/` and `lib/` pure logic. **Integration** tests run
  every API route and MCP tool (happy + failure path) against a real Postgres with
  storage and the LLM faked at the adapter boundary. **Evals** score metadata
  generation and feedback synthesis (including prompt-injection cases) against
  golden datasets.
- **Smoke** (`scripts/smoke.ts`) exercises the full end-to-end loop over HTTPS —
  gallery loads, publish via REST, artifact page renders, MCP initialize +
  tools/list + search round-trip, share link create + resolve, revoke, cleanup.
  It runs in CI after a successful Vercel **production** deploy via
  `.github/workflows/smoke.yml` (or `SMOKE_BASE_URL=<url> pnpm smoke` by hand).

## Security model (summary)

- **Untrusted content is sandboxed.** HTML/SVG render only inside `sandbox`
  iframes pointed at `/raw/[id]`, which serves a per-kind Content-Security-Policy
  (`connect-src 'none'` so scripts can't exfiltrate, no `allow-same-origin`) plus
  `X-Content-Type-Options: nosniff`. Artifact content is never
  `dangerouslySetInnerHTML`.
- **Share tokens** are `linkId.HMAC-SHA256(linkId.expiry, SHARE_LINK_SECRET)`,
  compared in constant time, backed by a DB row for revocation; only the token
  hash is stored, and full tokens are never logged.
- **Writes are bearer-gated** (constant-time check) on REST and MCP, before any
  core call; reads and shared-artifact access are token-gated by the share link.
- **Uploads** are size-capped and MIME-sniffed server-side (never trusting the
  client's declared type).

Every invariant above is backed by automated tests (`tests/integration/raw.test.ts`,
`artifacts.api.test.ts`, `mcp.write-tools.test.ts`, `sharing.core.test.ts`).

## Upload limits & known constraints

The stored-artifact hard cap is **25 MB** (`MAX_ARTIFACT_BYTES`, enforced
server-side from the sniffed byte length). The maximum you can actually upload,
however, is set by the *transport*, because on Vercel a serverless function's
request body is capped at ~4.5 MB — so how bytes reach the server matters:

| Surface | How content is sent | Practical ceiling | Why |
|---|---|---|---|
| Web publish form | multipart via a Next **Server Action** | **~4 MB** | `serverActions.bodySizeLimit` is set to `4mb` in `next.config.ts`, just under Vercel's ~4.5 MB body cap. Uploading a larger file 500s in the framework *before* the handler runs. |
| REST / MCP inline | `content` (text) or `contentBase64` (binary) in the request body | **~3 MB decoded** | The body itself is capped at ~4.5 MB and base64 inflates ~1.37×. |
| REST / MCP `sourceUrl` | a public `https` URL the **server** streams | **25 MB** (the full cap) | Bytes never ride the client→function request body; the server fetches them (SSRF-guarded: DNS-resolved-IP allowlisting, https-only, redirect cap, 25 MB stream abort). |

So the full 25 MB is reachable today only via the `sourceUrl` path; the web form
and inline API/MCP paths are bounded by the request-body cap. The web form's copy
reflects its real ~4 MB limit.

**Follow-up (deferred):** to let the web form reach the full 25 MB, upload
client-direct-to-Blob (browser → Vercel Blob via a short-lived token) and pass the
resulting URL to the server, bypassing the Server-Action body cap. Tracked in
`PLAN.md` (Decision Log, 2026-07-06 size-handling entry).
