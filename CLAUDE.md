# CLAUDE.md — Artifact Hub

Operating manual for AI-assisted development in this repo. Read `PLAN.md` before starting any work. `PLAN.md` is the source of truth for scope, architecture, and phase order — this file is the source of truth for *how* to work.

## Project

Artifact Hub: a platform for publishing, browsing, reviewing, and sharing AI-generated content (HTML, images, PDFs, Markdown, and more). Web UI + REST API + remote MCP server, with LLM-powered metadata generation and feedback synthesis. Single deployable Next.js app.

## Golden rules

1. **Plan before code.** For any non-trivial task, state the approach in 2–5 bullets first. If the approach deviates from `PLAN.md`, stop and flag it — do not silently diverge.
2. **Work phase by phase.** Complete the current `PLAN.md` phase, verify its acceptance criteria, check off its checklist items in `PLAN.md`, then move on. Never start Phase N+1 with failing gates in Phase N.
3. **Small, coherent commits.** Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`). One logical change per commit. Commit messages explain *why* when it isn't obvious.
4. **Quality gates before every commit:** `pnpm check` (typecheck + lint + format) and `pnpm test` must pass. Never commit with a failing gate; never weaken a gate to make it pass.
5. **Boundaries are typed.** Every external input (HTTP body, MCP tool args, LLM output, env vars) is validated with Zod at the boundary. No `any`. No unvalidated `JSON.parse`.
6. **Less code is better code.** Prefer deleting over abstracting. No speculative generality, no premature interfaces, no comments that restate the code. Comment only non-obvious *why*.
7. **Never commit secrets.** All secrets via env vars, documented in `.env.example` with placeholder values. If a secret ever lands in a diff, stop and say so.
8. **LLM output is untrusted input. Artifact content is untrusted input.** Validate both. Never interpolate artifact content into a prompt without the injection-hardening pattern in `src/lib/ai/prompts/` (see PLAN §AI Guardrails).

## Commands

```
pnpm dev              # Next.js dev server
pnpm build            # production build
pnpm check            # typecheck + biome lint + format check (must pass before commit)
pnpm test             # vitest run (unit + integration)
pnpm test:watch       # vitest watch
pnpm eval             # run LLM eval harness against golden dataset (needs ANTHROPIC_API_KEY)
pnpm db:generate      # drizzle-kit generate migrations from schema
pnpm db:migrate       # apply migrations
pnpm db:seed          # seed demo data (idempotent)
pnpm db:studio        # drizzle studio
```

## Architecture map

```
src/
  app/                    # Next.js App Router
    (gallery)/            # browse, artifact detail, publish UI
    share/[token]/        # public share-link viewer (no auth)
    raw/[id]/             # sandboxed artifact content serving (strict CSP, separate origin path)
    api/
      mcp/                # MCP server endpoint (Streamable HTTP, stateless)
      v1/                 # REST API routes (thin: parse → validate → call core → respond)
  core/                   # ALL business logic lives here — framework-free, fully unit-testable
    artifacts/            # publish, list/search, get, delete
    sharing/              # share-link create/verify/revoke (HMAC tokens)
    feedback/             # comments + synthesis orchestration
    ai/                   # LLM features: metadata generation, feedback synthesis
  db/                     # drizzle schema, migrations, seed
  lib/
    ai/                   # Anthropic client wrapper, prompt registry (versioned), llm call logger
    storage/              # blob storage adapter
    validation/           # shared Zod schemas (single source of truth: API + MCP + core)
  mcp/                    # MCP tool definitions — thin wrappers over core/, rich descriptions
tests/
  unit/                   # core/ logic, pure functions
  integration/            # API routes + MCP tools against a real test DB
  evals/                  # golden datasets + scoring for LLM features
```

**Dependency rule:** `app/` and `mcp/` depend on `core/`; `core/` depends on `lib/` and `db/`; nothing depends on `app/`. MCP tools and API routes must stay thin — if logic appears in a route handler or tool handler, move it to `core/`.

## Stack (do not substitute without flagging)

- Node 24 LTS (pin via `.nvmrc` + `engines` in package.json), TypeScript strict mode, pnpm
- Next.js 16.x (App Router, Server Components, Server Actions where they simplify; Turbopack is the default bundler — do not add webpack config; `next lint` no longer exists, linting is Biome's job)
- Tailwind CSS v4 + shadcn/ui
- Drizzle ORM + Postgres (Neon); Vercel Blob for artifact binaries
- Zod v4 (import from `zod`; at v4.4+ the `zod/v4` subpath is no longer needed — verified 2026-07-05) — schemas shared across API, MCP, core
- MCP: latest official TypeScript SDK — install the current server package (`@modelcontextprotocol/server`, or `@modelcontextprotocol/sdk` if the split packages don't fit the Next.js route setup) — Streamable HTTP transport, **stateless mode** (new server+transport instance per request). Follow the installed version's own docs for imports/APIs; do not copy tutorial-era snippets without checking them against the installed types
- `@anthropic-ai/sdk` — Claude Haiku for metadata/synthesis (model id in `src/lib/ai/config.ts`, never hardcoded elsewhere)
- Biome (lint + format), Vitest, GitHub Actions CI, pino (structured logs)

## Coding standards

- **Errors:** typed domain errors in `core/` (e.g., `ArtifactNotFoundError`); routes/tools map them to HTTP codes / MCP error results. Never throw raw strings. Never swallow errors silently — log with context via pino.
- **MCP tool errors must be LLM-recoverable:** error text says what went wrong *and* what to do next (e.g., "artifact `x1` not found — call `search_artifacts` to discover valid ids").
- **Naming:** files kebab-case, exported symbols named (no default exports except Next.js pages/routes where required).
- **Async:** no floating promises (lint-enforced). Use `Promise.all` for independent I/O.
- **DB:** all access through Drizzle in `core/` or `db/`; no SQL in route handlers. Every list query paginated.
- **UI:** every list view has an empty state; every async view has a loading state; every mutation has error feedback. Copy is plain language for non-technical users.
- **Tests:** new `core/` logic ships with unit tests in the same PR/commit. Integration tests cover every MCP tool and every API route happy path + one failure path minimum.

## Security invariants (never violate)

- User-uploaded HTML renders **only** inside `sandbox`-attribute iframes pointed at `/raw/[id]`; user-uploaded SVG renders **only** via `<img>` pointed at `/raw/[id]` (an image decoding context is script-inert by spec — stricter than an empty-sandbox iframe; decision 2026-07-07). `/raw` serves both with a `Content-Security-Policy` whose `sandbox` directive covers direct navigation and blocks scripts' network access, plus `X-Content-Type-Options: nosniff`. Never `dangerouslySetInnerHTML` artifact content.
- Share tokens: HMAC-signed, embed expiry, backed by a DB row for revocation. Constant-time comparison. Never log full tokens.
- MCP/API write operations require the bearer token; reads on shared artifacts are token-gated by share link. Auth check happens in middleware/handler before any core call.
- Upload limits enforced (size + MIME allowlist) server-side, not just in UI.

## When uncertain

Prefer the boring, well-documented approach. If a library/API detail is uncertain, check the installed version's types/docs rather than guessing. If a product decision is ambiguous, choose the option a non-technical end user would find most obvious, and note the decision in `PLAN.md` under Decision Log.
