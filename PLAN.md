# PLAN.md — Artifact Hub Build Plan

Source of truth for scope, architecture, contracts, and phase order. Execute phases in order. Each phase ends with its acceptance criteria verified and its checklist checked off. Update the Decision Log when a choice is made that this plan didn't anticipate.

## 1. Product definition

**Problem.** Teams generate content with AI tools (mockups, reports, presentations, diagrams), but the post-generation lifecycle is broken: files sit in blob storage behind CLI commands, get shared via expiring URLs pasted into chat, and feedback scatters across threads. There is no catalog, no structured review, and no real access control.

**Solution.** Artifact Hub — a single place to publish, browse, review, and share AI-generated artifacts:

- **Publish** artifacts with metadata (title, description, tags, type) via web UI or conversationally via MCP.
- **Browse** a visual gallery with search and tag/type filtering; preview artifacts in place.
- **Share** via revocable, time-limited signed links that work for people outside the platform.
- **Review** with structured comments; AI synthesizes multi-reviewer feedback into consensus/disagreement/action items.
- **MCP server** so Claude Desktop and other MCP clients can publish, search, share, and read feedback in natural conversation.

**Design principles.**
1. A non-technical person can publish, browse, and comment without instructions.
2. AI features are invisible infrastructure: they pre-fill, synthesize, and assist — they are never a "✨ AI" button that is the point of the screen.
3. Every capability is available identically via UI, REST API, and MCP (shared core, shared validation).
4. Ship polished core flows over broad feature surface.

## 2. Supported artifact types

| Category | MIME / extensions | Preview strategy |
|---|---|---|
| HTML | `text/html` | Sandboxed iframe via `/raw/[id]` (strict CSP; no top-navigation, no downloads) |
| Images | png, jpg, webp, gif, avif | `<img>` from blob URL; natural-size constrained |
| SVG | `image/svg+xml` | Treated as active content: served like HTML in sandboxed iframe (SVG can carry scripts) |
| PDF | `application/pdf` | Native browser viewer in iframe |
| Markdown | `text/markdown` | Server-rendered to sanitized HTML (rehype-sanitize) |
| Plain text / code | `text/plain`, common code extensions | Syntax-highlighted read-only viewer |
| JSON | `application/json` | Pretty-printed, collapsible viewer |
| CSV | `text/csv` | First N rows rendered as a table + download link |
| Everything else | any | Metadata card + download link (graceful fallback — publishing never fails on type) |

**Limits:** 25 MB per file (server-enforced). MIME sniffed server-side from magic bytes (`file-type` package), never trusted from the client. Extension/MIME mismatch → stored under sniffed type.

## 3. Architecture

Single Next.js deployable on Vercel. Postgres (Neon) for metadata/comments/links/telemetry. Vercel Blob for binaries. MCP server mounted at `/api/mcp` using Streamable HTTP in stateless mode. All business logic in framework-free `core/` modules consumed by three thin adapters: UI (server components/actions), REST (`/api/v1`), MCP tools.

```
Web UI ──┐
REST ────┼──► core/ (artifacts, sharing, feedback, ai) ──► db/ (Drizzle/Postgres)
MCP  ────┘                                            └──► lib/storage (Blob)
                                                      └──► lib/ai (Anthropic + telemetry)
```

**Why a monolith:** one deploy target, one URL for reviewers, shared types end-to-end. The `core/` boundary keeps a future split (separate MCP service, workers) mechanical rather than a rewrite.

### 3.1 Data model (Drizzle / Postgres)

```
artifacts
  id            text pk (nanoid)
  title         text not null
  description   text
  content_type  text not null            -- sniffed MIME
  kind          text not null            -- enum: html|image|svg|pdf|markdown|text|json|csv|other
  tags          text[] default '{}'
  blob_url      text not null
  size_bytes    int not null
  source        text not null            -- enum: web|mcp|api
  ai_generated_meta jsonb                -- {title?, description?, tags?} — what AI suggested (audit)
  created_at / updated_at timestamptz

comments
  id, artifact_id fk (cascade), author_name text not null,
  body text not null (1..5000 chars), created_at

feedback_summaries
  artifact_id pk fk, summary jsonb not null,   -- {consensus[], disagreements[], action_items[], sentiment}
  comment_count_at_generation int, model text, prompt_version text,
  generated_at timestamptz

share_links
  id text pk, artifact_id fk, token_hash text not null unique,
  expires_at timestamptz not null, revoked_at timestamptz,
  created_by text, last_accessed_at, access_count int default 0

llm_calls                                  -- observability (§6)
  id, feature text, model text, prompt_version text,
  input_tokens int, output_tokens int, latency_ms int,
  cost_usd numeric, outcome text,          -- ok|schema_retry_ok|fallback|error
  artifact_id text nullable, error text nullable, created_at
```

Indexes: `artifacts(created_at desc)`, GIN on `artifacts(tags)`, `comments(artifact_id, created_at)`, `share_links(artifact_id)`, `llm_calls(feature, created_at)`.

### 3.2 Search (v1)

Postgres full-text: generated `tsvector` column over title + description + tags, GIN-indexed, combined with kind/tag filters and recency ranking. No embeddings in v1 (see §9). The MCP `search_artifacts` tool and the UI search box hit the same `core/artifacts/search.ts`.

### 3.3 Share links

- Token: `id.signature` where signature = HMAC-SHA256(id + expiry, `SHARE_LINK_SECRET`), base64url. DB row holds `token_hash` (sha256), expiry, revocation.
- Verification: constant-time signature check → DB lookup → expiry + revocation check → increment access counter.
- Share viewer page (`/share/[token]`) is read-only: artifact preview + comments visible; commenting allowed (name required) so external reviewers can leave feedback — this is the core review loop.
- Owner UI lists active links per artifact with expiry countdown, access count, and one-click revoke.
- Durations offered: 1h, 24h, 72h, 7d, 30d.

### 3.4 Auth model (deliberately minimal)

Single-team trust model. Write operations (publish, delete, share-link management) require `ADMIN_API_TOKEN` bearer auth on REST/MCP; the web UI holds a session established via a simple token-gate page (enter the team token once, stored as httpOnly cookie). Comments require only a name. No user accounts — see Cut List for rationale. All auth checks precede core calls.

## 4. MCP server

- Transport: **Streamable HTTP, stateless** — new `McpServer` + transport per request (`sessionIdGenerator: undefined`), full isolation between concurrent clients, serverless-friendly.
- Endpoint: `POST /api/mcp`. Bearer token required for write tools; read tools open.
- Server `instructions` field documents cross-tool workflow: publish → returns id → share/feedback tools take id; recommend `search_artifacts` before acting on ambiguous references.
- Every tool: Zod `inputSchema` (tight: enums, min/max, formats) + `outputSchema` (structured content). Descriptions written for an LLM operator: purpose, when to use, what it returns.

### 4.1 Tools

| Tool | Purpose | Notes |
|---|---|---|
| `publish_artifact` | Publish content (inline text/HTML/markdown/JSON or base64 for binaries) | Missing title/description/tags → AI generates them; response marks which fields were AI-filled and reminds the model to confirm with the user |
| `search_artifacts` | Full-text + tag/kind/date filters | Returns compact summaries (id, title, kind, tags, created, comment_count); paginated |
| `get_artifact` | Full metadata + content preview (text kinds inline up to 8 KB, otherwise URL) | |
| `create_share_link` | Time-limited link; duration as `"24h" \| "72h" \| "7d" \| "30d" \| "1h"` enum | Returns full URL + human-readable expiry |
| `revoke_share_link` | Revoke by link id | Lists active links in error message if id unknown |
| `get_feedback` | All comments + current AI synthesis for an artifact | Triggers synthesis refresh if stale (new comments since last run) |
| `add_comment` | Leave a comment as a named author | Enables "reply to the design feedback" conversational flows |
| `hub_stats` | Counts by kind/tag, recent activity | Cheap situational awareness for "what's new this week?" queries |

Error convention: every error result names the failure and the recovery path in one sentence.

### 4.2 Reviewer connection (README section, two paths)

1. Claude Desktop → Settings → Connectors → add remote MCP server URL `https://<host>/api/mcp` (+ bearer token).
2. stdio-only clients: `claude_desktop_config.json` snippet using `npx mcp-remote <url> --header "Authorization: Bearer <token>"`.

## 5. LLM features

Model: Claude Haiku (fast/cheap; id centralized in `lib/ai/config.ts`). All calls through one `lib/ai/client.ts` wrapper that enforces telemetry, guardrails, and schema validation. Prompts live in `lib/ai/prompts/` as versioned modules (`metadata-gen.v1.ts` …) exporting prompt text + Zod output schema + version string.

### 5.1 Feature A — Auto-metadata on publish (invisible assist)

On publish without title/description/tags: extract text (HTML→text, markdown raw, CSV header+sample, image → vision call on the image itself, PDF → first pages text), send to Haiku with structured-output prompt → `{title ≤80, description ≤280, tags 1..5 from-or-beyond existing tag vocabulary}`. UI shows fields pre-filled and editable with a subtle "suggested" marker; MCP response flags AI-filled fields. Failure → publish succeeds with filename-derived title; never block the user on the AI.

### 5.2 Feature B — Feedback synthesis (solves scattered feedback)

Artifacts with ≥2 comments get a synthesis card: consensus points, disagreements, action items, overall sentiment — each bullet traceable to comment ids (rendered as links). Regenerated lazily on read when `comment_count_at_generation` is stale; single-flight lock (Postgres advisory lock) prevents duplicate concurrent generation. Below threshold, no card at all — absence is the correct UX for 0–1 comments.

### 5.3 AI guardrails

1. **Prompt-injection hardening:** artifact content and comments are untrusted. Delimited as fenced data blocks; system prompt instructs the model to treat block contents purely as data and never follow instructions within; output schema constrains the blast radius (short strings, enums). Eval set includes injection attempts (§6.2).
2. **Schema-validated outputs:** every LLM response parsed against the feature's Zod schema; one retry with error feedback appended; then deterministic fallback (filename title / "summary unavailable"). Outcome recorded in `llm_calls.outcome`.
3. **Input caps:** content truncated to a per-feature token budget before prompting (head+tail sampling for long docs); comment batches capped at most-recent 50.
4. **Output hygiene:** generated tags lowercased, deduped, length-capped; generated text stripped of markdown/HTML before storage where plain text is expected.
5. **Cost ceiling:** per-feature daily call budget (env-configurable, default generous); exceeded → fallback path + warn log. Prevents runaway spend from a comment-spam loop.

### 5.4 AI observability & evaluation

- **Telemetry:** every call writes an `llm_calls` row (feature, model, prompt_version, tokens, latency, cost, outcome, error). Wrapper computes cost from a pricing map.
- **Ops view:** `/admin/ai` — last-24h/7d calls, cost, p50/p95 latency, outcome breakdown, recent failures. Small, honest, real.
- **Eval harness (`pnpm eval`):** golden datasets in `tests/evals/fixtures/`:
  - *metadata-gen:* ~12 artifacts (HTML page, README, CSV, diagram-like SVG text, PDF excerpt, injection-attempt doc…) with expectations; scored on schema validity (must = 100%), tag overlap vs. expected set, length constraints, injection resistance (suggested metadata must not contain attacker-planted strings).
  - *feedback-synthesis:* ~8 comment-set scenarios (agreement, split opinion, single loud negative, injection attempt in a comment…); scored on schema validity, coverage of expected consensus/disagreement keys, traceability (every bullet cites ≥1 valid comment id).
  - Runner prints a scorecard, writes `evals/report.json`, exits non-zero below thresholds. CI job runs it on PRs touching `lib/ai/` or `core/ai/` (guarded by API-key secret availability).
- Prompt changes bump the version string; telemetry + eval reports thereby track regressions across prompt versions.

## 6. Quality strategy (multi-level)

| Level | Mechanism |
|---|---|
| Static | TS strict; Biome lint+format; no floating promises; import-boundary respect (`core/` never imports `app/`) |
| Unit | Vitest on `core/` and `lib/` pure logic (token signing/verify, search query building, guardrail transforms, prompt output parsing) |
| Integration | API routes + all MCP tools exercised against a real Postgres test DB (Neon branch or local docker) + mocked LLM; every tool: happy path + ≥1 failure path |
| LLM evals | §5.4 harness with thresholds |
| E2E smoke | Post-deploy script hits: gallery loads, publish via API, artifact page renders, MCP `initialize` + `search_artifacts` round-trip, share link create+resolve |
| CI | GitHub Actions: install → check → test → build on every push; eval job conditional; smoke job after production deploy |
| Local | Lefthook pre-commit: biome + typecheck on staged scope |
| Runtime | pino structured logs (request id, route, latency); global error boundary UI; API error envelope `{error: {code, message}}` |

Coverage gate on `core/` (≥85% lines) — enforced only where it's meaningful, not repo-wide theater.

## 7. UX requirements (product-feel checklist)

- Gallery: responsive card grid, type icon/thumbnail, tag chips (click = filter), search box, kind filter, sort by recent. Empty state with a "publish your first artifact" CTA.
- Publish: drag-and-drop or paste; type auto-detected; metadata fields pre-fill (AI) after upload with editable "suggested" state; clear size/type errors.
- Artifact page: preview front and center, metadata sidebar, share-link manager, comments with synthesis card, copy-link button.
- Share view: clean read-only page, expiry visible ("link expires in 2 days"), comment box with name field. Expired/revoked → friendly explanation page, not a 404.
- Loading: skeletons on gallery/artifact; optimistic comment append.
- Accessibility: semantic landmarks, focus states, alt text, keyboard-reachable actions, WCAG AA contrast.
- Seed data: ~8 realistic artifacts across all kinds with tags, comments (some with 3+ to showcase synthesis), one active share link. `pnpm db:seed`, idempotent, runs against prod once at launch.

## 8. Phases

### Phase 0 — Foundation
Scaffold Next.js + TS strict + Tailwind/shadcn + Biome + Vitest + Lefthook + CI skeleton; Drizzle schema + migrations; blob + Neon wiring; `.env.example`; deploy the walking skeleton to Vercel (empty gallery page live).
**Accept:** CI green; production URL serves the app; `pnpm check && pnpm test` pass locally and in CI.
_(Deploy deferred by decision 2026-07-05 — Phase 0 exit redefined to: `pnpm check && pnpm test && pnpm build` green locally, first migration generated, one clean local commit, GitHub remote created. The production-URL criterion moves to a later cloud phase.)_
- [x] Scaffold + tooling (Node 24 pinned via `.nvmrc`/`engines`; Next 16.2.10; MCP SDK docs to be verified at Phase 2 start)
- [x] Schema + migrations (all §3.1 tables/indexes; `pnpm db:migrate` verified against local docker Postgres)
- [x] CI pipeline (GitHub Actions: install → check → test → build; activates on first push)
- [ ] First deploy — deferred to a later cloud phase (see Decision Log)

### Phase 1 — Publish & browse (core loop)
`core/artifacts` (create, get, list/search, delete) + upload pipeline (sniff, limits, blob) + REST routes + gallery UI + artifact page with all §2 preview renderers + `/raw/[id]` sandboxed serving.
**Accept:** all §2 types publishable and previewing correctly; search/filter works; integration tests green; deployed.
_(Local Phase 1 verified 2026-07-05: read/preview loop for all §2 kinds exercised against a running dev server via `data:`-URL-seeded rows; `pnpm check && pnpm test && pnpm build` green (34 tests). The publish→Vercel-Blob write path is verified in prod with a real `BLOB_READ_WRITE_TOKEN` — see Decision Log.)_
- [x] core/artifacts + tests (create/get/list-search/delete/content; unit + integration)
- [x] Upload pipeline (two-tier sniffing, 25 MB limit, Vercel Blob adapter)
- [x] Preview renderers incl. sandboxed HTML/SVG (`/raw/[id]` per-kind CSP)
- [x] Gallery + artifact page UI (+ publish/unlock token-gate, delete)
- [x] REST v1 routes + integration tests (happy + failure per route)

### Phase 2 — MCP server
Stateless Streamable HTTP endpoint; all §4.1 tools over `core/`; bearer auth; instructions field; integration tests per tool; verify from Claude Desktop against the deployed URL. Re-scoped 2026-07-06 to pull the tool-backing core forward from Phase 3 (see Decision Log): the 8 tools must wrap real `core/`, so `core/sharing` and `core/feedback` are built and unit-tested here; Phase 3 keeps the UI/flow.
**Accept:** reviewer-style connection works remotely; conversational flow "publish this HTML → share for 72h → any feedback?" completes end-to-end.
- [x] Endpoint + auth (stateless Web-standard transport; bearer verified in-route, write tools gated, reads open)
- [x] 8 tools + schemas + recoverable errors (reusing `lib/validation`; LLM-operator descriptions)
- [x] `core/sharing` (HMAC create/verify/revoke, constant-time) + `core/feedback` (add/list comments) + `core/stats`, with unit tests
- [x] Tool integration tests (in-memory MCP client + direct route handler; happy + failure per tool, incl. write auth-denial)
- [x] `scripts/smoke.ts` (`pnpm smoke`) — post-deploy MCP loop over HTTPS
- [ ] Verified from Claude Desktop (remote) — manual, against the deployed URL

### Phase 3 — Sharing & feedback (UI/flow)
Re-scoped 2026-07-06: `core/sharing` (sign/verify/revoke) and `core/feedback` (comments) were built + unit-tested in Phase 2 to back the MCP tools, so Phase 3 is now UI-and-flow only — the `/share/[token]` viewer over the existing `verifyShareToken`, expired/revoked pages, the share-view comment form over `addComment`, the owner-side link-management UI (list/countdown/one-click revoke), and surfacing the access counters.
**Accept:** link lifecycle (create → access → expire/revoke) works through the UI; external commenting works on the share view.
- [ ] `/share/[token]` viewer + friendly expired/revoked pages (flips the smoke script's share-fetch step to a hard assertion)
- [ ] External commenting on the share view (name + body over `core/feedback`)
- [ ] Owner link-management UI (active links, expiry countdown, access count, one-click revoke)
- [ ] Publish/gallery wiring for share management

### Phase 4 — AI features + observability
`lib/ai` wrapper (telemetry, retries, fallbacks, cost map) → Feature A → Feature B (advisory-lock single-flight) → guardrails → `/admin/ai` → eval harness + golden sets + CI eval job.
**Accept:** `pnpm eval` passes thresholds; publish-without-metadata pre-fills in UI and MCP; synthesis card appears at ≥2 comments and cites comment ids; telemetry rows visible in `/admin/ai`.
- [ ] AI client wrapper + llm_calls telemetry
- [ ] Auto-metadata (all content kinds incl. image vision)
- [ ] Feedback synthesis + staleness/locking
- [ ] Guardrails (injection blocks, caps, hygiene, budget)
- [ ] /admin/ai dashboard
- [ ] Eval harness + fixtures + CI job

### Phase 5 — Polish, seed, harden
Empty/loading/error states pass; a11y pass; seed data; post-deploy smoke script; rate limiting on public endpoints (comment spam); security review vs. CLAUDE.md invariants; README (setup, reviewer MCP connection, architecture summary).
**Accept:** smoke script green against production; a fresh visitor can understand and use the product with zero instructions.
- [ ] UX/a11y pass
- [ ] Seed production
- [ ] Smoke script + CI hook
- [ ] Rate limiting
- [ ] README

### Phase 6 — Documentation & walkthrough support
WRITEUP.md (decisions, cuts, architecture, MCP design, LLM usage + eval results, deployment, next steps); walkthrough script/recording checklist demonstrating the full loop including publishing an artifact *through* the MCP server.
- [ ] WRITEUP.md
- [ ] Walkthrough

## 9. Cut list (deliberate non-goals, with rationale)

| Cut | Rationale | Future path |
|---|---|---|
| User accounts / SSO / roles | Single-team trust model covers the access-control requirement (signed links + team token) without spending a phase on auth plumbing that demonstrates nothing novel | NextAuth/Auth.js + orgs table; `core/` is auth-agnostic so it slots in at the adapter layer |
| Semantic / embedding search | Postgres FTS is excellent at this catalog size; embeddings add infra + eval burden for marginal v1 gain | pgvector column + hybrid rank |
| Artifact versioning | Publish-new beats version-tree complexity for the core review loop | `artifact_versions` table; UI diff for text kinds |
| Smart review routing | Requires org/people model that doesn't exist (see auth cut) | After accounts: routing rules on tags/kinds |
| Notifications (email/Slack) | Integration surface + secrets for a demo audience of one | Webhook on comment/synthesis events |
| Realtime (websockets) | Lazy refresh + optimistic UI feel fine at this scale | — |
| MCP OAuth 2.1 (resource indicators, protected-resource metadata) | Bearer token is honest for single-team v1; full authorization spec is the documented production path | Implement Nov-2025 MCP auth spec |
| Thumbnail generation pipeline | Type icons + inline previews carry the gallery | Worker + sharp on upload |
| OpenTelemetry | pino + llm_calls table give proportionate observability | OTel SDK exporting to hosted collector |

## 10. Environment & config

```
DATABASE_URL=               # Neon Postgres
BLOB_READ_WRITE_TOKEN=      # Vercel Blob
ANTHROPIC_API_KEY=
SHARE_LINK_SECRET=          # 32+ random bytes
ADMIN_API_TOKEN=            # bearer for writes (REST/MCP) + UI token-gate
APP_BASE_URL=               # absolute URL for share links
AI_DAILY_CALL_BUDGET=500    # per-feature guardrail
```

`lib/env.ts` validates all env vars with Zod at boot; missing/invalid → fail fast with a clear message.

## 11. Decision log

| Date | Decision | Rationale |
|---|---|---|
| (init) | Monolith over split services | One deploy target; `core/` boundary keeps future split mechanical |
| (init) | Stateless MCP transport | Serverless-friendly; no session needs; per-request isolation |
| (init) | SVG treated as active content | SVG can embed script; same sandbox as HTML |
| (init) | Postgres FTS over embeddings | Right-sized; see cut list |
| (init) | Node 24 LTS, Next.js 16.x | Node 24 is active LTS (22 in maintenance); Next 16 is the active LTS line — Turbopack default, `next lint` removed (Biome covers linting) |
| (init) | Latest MCP TS SDK, verified against installed docs | SDK is mid-transition to split `@modelcontextprotocol/server`/`client` packages; APIs must come from installed version's docs, not tutorials |
| 2026-07-05 | Phase 0 deploy deferred | User chose to build locally first. Phase 0 exit = green locally + first migration + committed + GitHub remote created (`alireza1989/artifact-hub`, private). Production deploy (Neon/Vercel/Blob) moves to a later cloud phase. |
| 2026-07-05 | *Select* stable `@modelcontextprotocol/sdk` 1.29.0 for the MCP route (added to the lockfile only; **not installed as a dependency** until Phase 2) | Split `@modelcontextprotocol/server` is still beta (2.0.0-beta.2); prefer the boring, documented stable SDK. Re-verify against installed types at Phase 2 start. |
| 2026-07-05 | Zod bare `zod` import at v4.4.x | Zod 4 is now the main package line; canonical import is `zod` (verified zod.dev). `zod/v4` was the transitional subpath. CLAUDE.md convention updated to match. |
| 2026-07-05 | Biome `noFloatingPromises` via `nursery` + type-aware scanner | Rule is nursery in Biome 2.5 and requires type info; enabled as `error` so the "no floating promises" gate is real. |
| 2026-07-05 | shadcn radix/nova preset; `shadcn` kept as a dependency | `globals.css` imports `shadcn/tailwind.css`, so the `shadcn` package is a build-time CSS dep. Chose classic radix primitives over the newer Base UI. |
| 2026-07-05 | Local DB driver = postgres.js | Deploy deferred, so local dev/tests use `postgres` (postgres.js). Swap to the Neon serverless driver at the cloud phase; `core/`/schema are driver-agnostic. |
| 2026-07-05 | `artifacts.search_vector` via IMMUTABLE wrapper function | Inline `to_tsvector`/`array_to_string` are only STABLE, and enum columns in the table taint the inline expression → "generation expression is not immutable". `artifact_search_document()` (IMMUTABLE) is hand-maintained at the top of migration `0000`; Drizzle doesn't model functions. |
| 2026-07-05 | Vercel Blob pulled forward; deploy un-deferred | User chose to install `@vercel/blob` in Phase 1 and test end-to-end to prod. `env.ts` unchanged (BLOB token stays required); the local-disk driver idea was dropped. Integration tests inject an in-memory `Storage` fake; local dev/preview verified via `data:`-URL seed rows. |
| 2026-07-05 | All content served through `/raw/[id]` | Blobs are stored public+random-suffixed but never linked to clients; `/raw` re-serves bytes under a per-kind CSP so HTML/SVG stay sandboxed (CLAUDE.md invariant) and dev/prod share one serving path. |
| 2026-07-05 | Two-tier MIME sniffing | `file-type` (magic bytes) for binaries; a content+extension classifier for text formats, which have no magic bytes. XML-declared content is deferred from tier 1 to the classifier so SVG-with-`<?xml>` isn't mislabeled `application/xml`. Sniffed type always wins over client/extension. |
| 2026-07-05 | Syntax highlighting deferred (shiki removed) | `shiki.codeToHtml` requires `dangerouslySetInnerHTML` on artifact-derived content, violating the "never dangerouslySetInnerHTML artifact content" invariant. Text/code render as React-escaped `<pre>`; revisit later via shiki's hast→JSX renderer. |
| 2026-07-05 | Web session = admin token in httpOnly cookie | §3.4 token-gate implemented so web publish/delete are auth-gated in Phase 1: `/unlock` sets the cookie after a constant-time compare to `ADMIN_API_TOKEN`; `/publish` and delete require it. |
| 2026-07-06 | Stay on `@modelcontextprotocol/sdk` 1.x stable (`1.29.0`); installed as a real dependency in Phase 2 | The split `@modelcontextprotocol/server` is still beta (`2.0.0-beta.2`, re-churned 2026-07-02) — wrong foundation under an auth-bearing endpoint. 1.29.0 is the current latest stable and now supports zod 4 (peer `^3.25 \|\| ^4.0`); pnpm resolves its zod peer to our zod 4.4.x (the zod-3 copy belongs only to shadcn's nested SDK). Uses the SDK's Web-standard Streamable HTTP transport (`Request`→`Response`), so no Node req/res bridge. **Re-evaluate when `@modelcontextprotocol/server` ships a stable 2.0.0 GA.** |
| 2026-07-06 | Pull `core/sharing` + `core/feedback` forward into Phase 2; re-scope Phase 3 to UI/flow | The 8 MCP tools must wrap real `core/`, but sharing/feedback core were Phase-3 stubs. Built + unit-tested them (plus `core/stats`) in Phase 2 so the tools are honest wrappers, not stubs; Phase 3 now owns only the share viewer, expired/revoked pages, share-view commenting, and link-management UI. |
| 2026-07-06 | `publish_artifact` size handling: ~3 MB inline/base64 + SSRF-guarded `sourceUrl` for up to 25 MB | Vercel caps function request bodies at 4.5 MB (confirmed current), so inline/base64 (base64 inflates ~1.37×) is capped at ~3 MB decoded with a clear error; larger binaries use an https `sourceUrl` the server streams (https-only, private/reserved-IP rejection, redirect cap, 25 MB stream cap). The 25 MB limit is unreachable via a direct function body — client-direct-to-Blob for large **web** uploads is a Phase-3/5 follow-up. |
| 2026-07-06 | Vercel Blob store switched public → **private** | The store provisioned for prod is private (public `put` → `BlobError: Cannot use public access on a private store`). Since every blob is already re-served through `/raw/[id]` and its URL is never given to clients, a private store is strictly better: `storage.read` now fetches via the SDK `get(url, { access: "private", token })` (a leaked URL 403s without the token — verified). Supersedes the "public+random-suffixed" note in the 2026-07-05 `/raw` entry; the adapter change is isolated to `lib/storage/vercel-blob.ts`. |
| 2026-07-06 | Share viewer distinguishes expired vs. revoked vs. invalid in its copy | Safe because the `expired`/`revoked` branches in `verifyShareToken` are only reachable *after* the constant-time HMAC signature check passes — i.e. only a holder of a validly-signed token (which requires `SHARE_LINK_SECRET`) ever sees them. A stranger guessing/forging tokens only ever gets the ambiguous `invalid` (never-existed + forged + tampered + missing-artifact), which confirms nothing. So distinguishing the states leaks no "was this token ever valid?" signal to anyone who doesn't already hold a real link. The reasoning is mirrored in a comment on the share state component. |
| 2026-07-06 | `verifyShareToken` gains `expiresAt` in its result + a `countAccess` option | Phase-3 viewer needs the expiry for the "expires in 2 days" countdown (not recoverable from the token, which is `linkId.signature` — expiry lives only inside the HMAC). The comment write re-verifies the token to authorize (never trusting a client-passed artifact id) but must not double-count a view the page GET already recorded, so it passes `countAccess: false`. Both keep all logic in `core/sharing` rather than re-implementing verify in the adapter. |
| 2026-07-06 | `sourceUrl` SSRF: accept residual DNS-rebinding (TOCTOU) risk for v1 | `fetchSourceBytes` validates the DNS-resolved IP (not just the hostname), enforces https-only, rejects private/loopback/link-local/reserved + cloud-metadata IPs, re-validates each redirect (cap 3), and stream-aborts at 25 MB. The one residual: global `fetch` re-resolves DNS independently of the validation lookup, so a hostile resolver could flip public→private between check and fetch. Accepted because the path is bearer-gated + single-team. **Future work: pin the validated IP into the socket via a custom `http.Agent` (`lookup` override).** Guards covered by unit tests in `tests/unit/artifacts/fetch-source.test.ts`. |

## 12. Phase 0 → Phase 1 handoff

- **Local DB:** `docker compose up -d`, then `DATABASE_URL=postgres://artifact_hub:artifact_hub@localhost:5432/artifact_hub pnpm db:migrate` (matches `.env.example`). `docker compose down -v` resets the volume.
- **Gotcha:** `drizzle-kit migrate` hides real SQL errors behind its spinner — to debug, apply the migration with `psql -v ON_ERROR_STOP=1 < src/db/migrations/0000_*.sql`.
- **Gotcha:** `artifacts.search_vector` depends on the IMMUTABLE `artifact_search_document()` function hand-added to the top of `0000_*.sql`; if you nuke & regenerate migrations, re-add it (rationale in `schema.ts`).
- **Half-wired (intentional):** `lib/env.ts` and `db/index.ts` are lazy and imported nowhere yet — Phase 1 wires them into server entrypoints. `id`s are app-generated (Drizzle `$defaultFn`), so raw SQL inserts must supply `id`.
- **Already logged deviations:** deploy deferred (no Neon/Vercel/Blob); `shadcn` is a real dependency (globals.css imports its CSS); `core/` coverage gate only runs under `--coverage`.
- **Not built yet:** `/publish` route (gallery CTA links to it), all `core/` logic, MCP tools, blob adapter — Phase 1+.
