# Artifact Hub

A platform for publishing, browsing, reviewing, and sharing AI-generated content
(HTML, images, PDFs, Markdown, and more). Web UI + REST API + remote MCP server,
with LLM-powered metadata generation and feedback synthesis. Single deployable
Next.js app.

See [`PLAN.md`](./PLAN.md) for scope, architecture, and phase order, and
[`CLAUDE.md`](./CLAUDE.md) for the development operating manual.

## Status

**Phase 0 — Foundation.** Project skeleton, tooling, database schema/migrations,
and CI are in place. Cloud provisioning (Neon, Vercel Blob) and the first
production deploy are deferred to a later phase; everything below runs locally.

## Stack

- Node 24 LTS · TypeScript strict · pnpm
- Next.js 16 (App Router, Turbopack) · Tailwind CSS v4 · shadcn/ui
- Drizzle ORM · Postgres · Vercel Blob (later phase)
- Zod v4 · Biome · Vitest · Lefthook · GitHub Actions
- MCP (stateless Streamable HTTP) · Anthropic SDK (Claude Haiku)

## Getting started

```bash
nvm use                 # Node 24 (see .nvmrc)
corepack enable pnpm    # if pnpm is not installed
pnpm install
cp .env.example .env.local   # fill in values before running server/DB commands
pnpm dev                # http://localhost:3000
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm check` | Typecheck + Biome lint + format check (pre-commit gate) |
| `pnpm test` | Vitest run |
| `pnpm eval` | LLM eval harness (Phase 4) |
| `pnpm db:generate` | Generate Drizzle migrations from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed demo data (Phase 5) |
| `pnpm db:studio` | Drizzle Studio |

## Layout

```
src/
  app/     Next.js App Router (gallery, share, raw serving, api/{mcp,v1})
  core/    framework-free business logic (artifacts, sharing, feedback, ai)
  db/      Drizzle schema + migrations
  lib/     ai client/config, storage adapter, shared Zod validation, env
  mcp/     MCP tool definitions (thin wrappers over core/)
tests/     unit · integration · evals
```

Dependency rule: `app/` and `mcp/` depend on `core/`; `core/` depends on `lib/`
and `db/`; nothing depends on `app/`.

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
and inline API/MCP paths are bounded by the request-body cap. The web form's
copy reflects its real ~4 MB limit.

**Follow-up (deferred):** to let the web form reach the full 25 MB, upload
client-direct-to-Blob (browser → Vercel Blob via a short-lived token) and pass
the resulting URL to the server, bypassing the Server-Action body cap. Tracked in
`PLAN.md` (Decision Log, 2026-07-06 size-handling entry).
