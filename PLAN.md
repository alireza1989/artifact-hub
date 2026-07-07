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
| SVG | `image/svg+xml` | Rendered via `<img>` from `/raw` — image context is script-inert by spec (2026-07-07 decision; `/raw`'s CSP `sandbox` still covers direct navigation) |
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
  body text not null (1..5000 chars), created_at,
  anchor jsonb nullable                    -- Phase 6: {type:"text-quote", quote, prefix?, suffix?} — null = unanchored (all pre-Phase-6 comments)

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
| `add_comment` | Leave a comment as a named author | Enables "reply to the design feedback" conversational flows. Phase 6: optional additive `anchor` field (text-quote) |
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
_(Phase 3 verified 2026-07-06 in-browser on a Vercel preview deploy: valid-link view + live expiry, friendly expired/revoked/invalid pages, external commenting (optimistic + honeypot + rate-limit), and owner link-management (create/countdown/access-count/one-click revoke). `pnpm check` + 111 tests + `pnpm build` green. The smoke share-fetch is now a hard assertion — it will pass against prod once this branch deploys there.)_
- [x] `/share/[token]` viewer + friendly expired/revoked pages (flips the smoke script's share-fetch step to a hard assertion)
- [x] External commenting on the share view (name + body over `core/feedback`)
- [x] Owner link-management UI (active links, expiry countdown, access count, one-click revoke)
- [x] Publish/gallery wiring for share management

### Phase 4 — AI features + observability
`lib/ai` wrapper (telemetry, retries, fallbacks, cost map) → Feature A → Feature B (advisory-lock single-flight) → guardrails → `/admin/ai` → eval harness + golden sets + CI eval job.
**Accept:** `pnpm eval` passes thresholds; publish-without-metadata pre-fills in UI and MCP; synthesis card appears at ≥2 comments and cites comment ids; telemetry rows visible in `/admin/ai`.
_(Phase 4 verified 2026-07-07: `pnpm check` + 165 tests (`pnpm test`) + `pnpm build` green, and `pnpm eval` green against real Haiku — metadata-gen 12 fixtures (schema 100%, length 100%, injection 100%, tag overlap 65%), feedback-synthesis 8 fixtures (schema 100%, traceable 100%, injection 100%, coverage 100%); scorecard in `evals/report.json`. Both features exercised through core + REST + MCP with the model mocked at the `lib/ai` wrapper boundary; guardrails (injection→constrained, malformed→retry→fallback, budget→fallback, oversized→capped), advisory-lock single-flight, and staleness all have automated tests. Owner UI verification (suggested badge, synthesis card, /admin/ai) is the one manual prod pass.)_
- [x] AI client wrapper + llm_calls telemetry (`lib/ai`: injectable model caller, budget/retry/fallback, one telemetry row per call with cost from a pricing map; versioned prompt registry)
- [x] Auto-metadata (all content kinds incl. image vision; PDF via `unpdf`; `publishArtifact` orchestrator fills only omitted fields, records `aiGeneratedMeta`, reports `aiFilled` on REST/MCP/UI)
- [x] Feedback synthesis + staleness/locking (`getFeedback` lazy-generates at ≥2 comments; `pg_advisory_xact_lock` single-flight; regenerates when `comment_count_at_generation` is stale)
- [x] Guardrails (fenced-data + system-prompt injection hardening; schema-validated outputs + one retry then deterministic fallback; head+tail input caps + comment-batch cap; tag/markup hygiene; env-configurable daily budget)
- [x] /admin/ai dashboard (session-gated; 24h/7d calls, cost, p50/p95 latency, outcome breakdown, recent failures — from `llm_calls`)
- [x] Eval harness + fixtures + CI job (`pnpm eval` = vitest against real Haiku; golden sets incl. injection cases; scorecard + `evals/report.json`; PR-scoped CI job guarded by `ANTHROPIC_API_KEY`)

### Phase 5 — Polish, seed, harden
Empty/loading/error states pass; a11y pass; seed data; post-deploy smoke script; rate limiting on public endpoints (comment spam); security review vs. CLAUDE.md invariants; README (setup, reviewer MCP connection, architecture summary).
**Accept:** smoke script green against production; a fresh visitor can understand and use the product with zero instructions.
_(Phase 5 verified 2026-07-07: `pnpm check` + `pnpm test` + `pnpm build` green; `pnpm smoke` green against production — gallery loads, publish via REST, artifact page renders, MCP initialize/tools-list/search round-trip, share create+resolve, revoke, cleanup. `pnpm db:seed` ran end-to-end against real Neon + Vercel Blob (8 artifacts, 15 comments, one active share link). Security review: all four CLAUDE.md invariants verified against code + backed by automated tests (CSP/nosniff/sandbox, 401 write-auth, constant-time token verify with expired/revoked/forged branches, server-side size limit + sniffed MIME). One manual prod pass remains for the owner UI a11y look.)_
- [x] UX/a11y pass (skip-link + landmarks; gallery/artifact loading skeletons; route `error.tsx`/`not-found.tsx`/`global-error.tsx`; table header scopes; focus-visible everywhere; empty/error states on every view; AA-contrast tokens)
- [x] Seed production (`src/db/seed.ts`: 8 realistic artifacts across every preview kind incl. a real generated PNG + PDF, tags, comment sets ≥3 for synthesis, one active share link; idempotent via stable ids; `--reset` sweeps smoke-test noise; run via `tsx`)
- [x] Smoke script + CI hook (`scripts/smoke.ts` covers the full §8 list; `.github/workflows/smoke.yml` runs it after a successful Production `deployment_status`)
- [x] Rate limiting (documented: in-memory fixed-window + honeypot accepted for v1 — see Decision Log)
- [x] README (setup, env vars, architecture, reviewer MCP connection both paths, seeding/reset, testing/smoke)

### Phase 6 — Product polish (design, deeper AI, anchored feedback, admin, workflow)

Phase 5 proved the flows; Phase 6 makes it *feel* like a product and deepens the AI without making it the point. Added 2026-07-07 (user decision); the former documentation phase is now Phase 7.

**Hard constraints for every item in this phase:**
1. **No breaking contract changes.** Existing MCP tool schemas, REST shapes, and share-link tokens stay valid as-is; all schema/tool changes are *additive optional fields only*. Old clients must keep working unchanged.
2. **AI stays invisible** (design principle 2): no new AI buttons-as-the-point; every new AI path uses the §5.3 guardrail stack (fenced data, Zod-validated output + one retry, input caps, daily budget) and writes `llm_calls` telemetry, and always has a deterministic fallback.
3. **Everything non-UI is provable with automated tests** (unit + integration, happy + ≥1 failure path, same bar as before). Visual/UI outcomes are verified manually on prod by the owner.
4. Work the sub-phases roughly in the order below (6.1 → 6.8); the **cut order** if the phase must shrink is: 6.7 → 6.9 → dark-mode → admin tag tile → 6.5 remainder → 6.3. Never cut 6.1/6.2/6.4/6.6.

#### 6.1 Design system pass (impact High / effort L — core, never cut)
Adopt shadcn as the real component layer (today only `button.tsx` exists in `src/components/ui/`). Install and standardize on: card, badge, input, textarea, dialog, dropdown-menu, tabs, tooltip, separator, skeleton, table, sonner, avatar. Visual identity: wordmark, one accent color via Tailwind v4 `@theme` tokens, self-hosted type family via `next/font` (no external fetch — CSP), consistent spacing/radius scale. Rebuild gallery cards on Card/Badge; artifact page → two-column with sticky metadata sidebar, preview as hero, Tabs for preview/raw; unify skeletons via `Skeleton`; **every mutation gets sonner feedback** (systematizes the CLAUDE.md "every mutation has error feedback" rule). Guided empty states (first-publish CTA, empty-search guidance) live here, not as a separate item. Tasteful and clean, not flashy — a non-technical visitor should land and think "this is a product".
_(6.1 done 2026-07-07: 15 shadcn components installed (card/badge/input/textarea/label/dialog/dropdown-menu/tabs/tooltip/separator/skeleton/table/sonner/avatar + button refresh); indigo-accent identity tokens in globals.css with AA-designed pairs; fixed the circular `--font-sans` var that silently dropped Geist; brand mark + wordmark in gallery/share headers; gallery cards on Card/Badge with stretched-link a11y; artifact page → 3xl title, two-column with sticky sidebar, Preview/Source tabs for HTML/SVG (source loaded server-side; "open in new tab" is safe — /raw CSP `sandbox` re-sandboxes direct navigation); every mutation now toasts via sonner (metadata save, share create/copy/revoke, comment post, publish/unlock errors); delete confirm() → Dialog; skeletons unified on Skeleton; guided empty states; admin/ai on Card/Table/Badge. `pnpm check` + 172 tests + `pnpm build` green; key routes smoke-rendered locally. Owner manual prod pass = the visual/a11y confirmation.)_
- [x] shadcn components installed + `button.tsx`-only status ended; visual identity tokens (accent, font, radius/spacing)
- [x] Gallery rebuilt (cards, grid rhythm, hover/focus, empty states)
- [x] Artifact page relayout (two-column, sticky sidebar, tabs)
- [x] Toasts on every mutation; unified skeletons
- [x] A11y bar maintained (skip-link/landmarks/labels kept; label-for associations improved; AA contrast designed into tokens — visual re-check is the owner's manual prod pass)

#### 6.2 Live gallery previews (impact High / effort M — core, never cut)
Replace the kind-icon fallback with a real preview per kind, **without** building the cut thumbnail pipeline (no worker, no sharp, no stored thumbnail bytes, no schema change — see Decision Log 2026-07-07): HTML/SVG → existing sandboxed `/raw/[id]` iframe scaled down with `pointer-events-none`; PDF → first page via the same iframe path; markdown/text/code/CSV → rendered snippet of first lines; other → keep icon. `image` kind already previews.
_(6.2 done 2026-07-07: `CardPreview` server component — HTML → scaled inert iframe `sandbox="allow-scripts"`, SVG → scaled inert iframe `sandbox=""`, PDF → viewer iframe `#toolbar=0`, markdown/text/json/csv → server-fetched first-bytes mono snippet with fade (capped 1.5 KB decode), other → icon; all iframes `loading="lazy"` + `pointer-events-none` + `tabIndex=-1` + `aria-hidden`, card wrapped in Suspense with icon fallback so snippet fetches stream in. Unreadable blob → icon + warn log, never a broken gallery (verified live against the legacy `data:`-URL rows in the shared DB, which fall back exactly this way). 9 new tests: unit (per-kind sandbox/inertness/lazy assertions by resolving the RSC element tree) + integration (snippet renders first lines, cap enforced, missing-artifact and whitespace-only fallbacks); /raw suite untouched and green. `pnpm check` + 181 tests + `pnpm build` green; html/svg card iframes confirmed rendering with correct sandbox attrs on a live gallery.)_
- [x] Per-kind preview components in the gallery card (client-side render of already-served content)
- [x] No `/raw` sandbox/CSP regression (existing integration tests still green; new tests assert the card iframes carry the sandbox attrs)
- [x] Perf sanity: previews lazy (`loading="lazy"` on all card iframes/images; snippet fetches stream via Suspense, capped decode; failure degrades to icon)

#### 6.3 Natural-language search (impact High / effort M — AI feature C)
The existing search box accepts natural language ("html mockups with feedback from last week"). A Haiku call translates the query into the **structured filters search already supports** (FTS terms + kind + tags + date range) feeding the existing `core/artifacts` search — a query pre-parser, not a new retrieval system, and **not** the cut embedding search (no pgvector; see Decision Log). Same box; short/keyword queries bypass the LLM entirely; any AI failure/budget-trip falls back to raw FTS with the original string — the user never sees an error from this path. Prompt versioned in `lib/ai/prompts/` (`nl-search.v1.ts`), output schema = the existing search-filter Zod shape.
_(6.3 done 2026-07-07: `nl-search.v1` prompt (fenced query, injection-hardened, loose JSON schema + strict parser) + `core/ai/nl-search.ts` — `looksNaturalQuery` bypass (<4 words & no "?" → straight FTS, zero model calls), `translateNlQuery` via `runFeature`, pure `mergeNlFilters` (explicit user filters always win), and `searchArtifactsNaturally` which re-runs the user's original words when a translation over-narrows to zero results — NL search is provably never worse than raw FTS. Prerequisite `since` date filter added additively to `listQuerySchema`/`listArtifacts` (REST/MCP gain it as a plain optional param). Gallery search box routes through it; MCP `search_artifacts` gains additive `since` + opt-in `natural: true` (default path byte-for-byte unchanged — the checklist's "query_mode" realized as a boolean). Telemetry feature id is **`nl-search`** (kebab-case, matching `metadata-gen`/`feedback-synthesis`; the checklist's `nl_search` spelling adjusted for consistency), budget-capped like A/B. 20 new unit+integration tests incl. no-LLM-call-on-keyword-query, telemetry row, since-window, fallback, zero-result re-run, explicit-filter precedence, MCP additive paths. Eval: 8 golden fixtures (kind synonyms, relative time, topic extraction, question phrasing, search-box injection) — `pnpm eval` green against real Haiku: schema 100%, injection 100%, filter accuracy 100%. `pnpm check` + 201 tests + `pnpm build` green.)_
- [x] `core/ai/nl-search.ts` (query→filters translation, heuristic LLM-bypass for trivial queries, FTS fallback) + unit tests
- [x] Wired into UI search box and (additively) `search_artifacts` MCP tool via optional `natural` flag + `since` filter — no existing arg semantics changed
- [x] `nl-search` eval set in `tests/evals/fixtures/` (golden queries → expected filter structures; schema validity, kind/tag/date extraction, injection resistance) wired into `pnpm eval` thresholds
- [x] Telemetry: `llm_calls.feature = "nl-search"`, budget-capped like Features A/B

#### 6.4 Anchored feedback — quote-to-comment, Tier 0 (impact High / effort M — core, never cut)
Select text in a markdown/text/code/CSV viewer → "Comment on this" → comment stores an optional `anchor` (`{type:"text-quote", quote, prefix?, suffix?}` for re-location; column added in §3.1). Quote renders above the comment; clicking scrolls to + highlights the source; anchor that no longer matches renders gracefully as a plain quote. Text kinds only. Works on the owner artifact page **and** the share view.
**Contract:** `anchor` is additive-optional on REST comment create and MCP `add_comment`; existing comments have `null` anchor; no existing client breaks. **Explicitly cut:** region-pins inside HTML/SVG — the `/raw` iframe is a security boundary and a postMessage coordinate channel from untrusted content is exactly the attack surface to avoid (documented future path). Image point-pins are Tier 1 / item 6.9.
_(6.4 + 6.9 done together 2026-07-07 (user decision — same column/schema/plumbing): migration `0001` adds nullable `comments.anchor` jsonb; `commentAnchorSchema` in `lib/validation` is a discriminated union of `text-quote` {quote≤300, prefix/suffix≤100} and `image-point` {xPct, yPct} (camelCase realized vs. the sketch's x_pct). Additive everywhere: `addCommentInputSchema` gains optional `anchor` (so MCP `add_comment` picks it up via `.shape`), `get_feedback` returns `anchor` per comment, the share action reads a JSON hidden field — malformed/forged anchors are **dropped, never a reason to reject the comment** (MCP, whose caller is a program, errors instead). Note: there is no REST comment route (comments are MCP + share-view only), so "REST + MCP" from the sketch resolves to share-action + MCP. UI: `AnchoredPreview` wraps the preview on share + owner pages — select text in markdown/text/json/csv → floating "Comment on this" → quote chip in the form; click an image → percent-based pin; numbered pin markers track the `<img>` box via ResizeObserver; chips above comments jump-to + flash the passage via the CSS Custom Highlight API (guarded; scroll works everywhere) and unlocatable quotes degrade to the plain chip. Owner page renders anchors read-only (no compose provider). HTML/SVG region pins stay cut (sandbox boundary). Synthesis instruction now passes anchored quotes as fenced `(about the passage: …)` context — prompt version bumped to `feedback-synthesis@2`. 14 new tests (core round-trip + null back-compat, MCP both variants + old shape + malformed-anchor rejection, share action valid/malformed/schema-invalid, schema bounds, pin numbering, synthesis context + sentinel stripping). `pnpm check` + 215 tests + `pnpm build` green. ⚠️ Deploy note: run `pnpm db:migrate` against prod before/with this deploy (additive ADD COLUMN).)_
- [x] Migration: nullable `comments.anchor` jsonb + shared Zod anchor schema in `lib/validation`
- [x] `core/feedback` accepts/returns anchors + unit tests (incl. null-anchor back-compat)
- [x] Share-action + MCP additive optional field + integration tests (old-shape request still succeeds); no REST comment route exists to extend
- [x] Selection UI on text-kind viewers (share view compose; owner page renders + jumps) + quote rendering/highlight jump
- [x] Synthesis prompt includes anchor quotes as extra context (fenced as data; no schema change to summaries; version → `feedback-synthesis@2`)

#### 6.5 Admin console (impact Med-High / effort M)
Grow `/admin` beyond `/admin/ai` into a small real console (session-gated with the existing token; all logic in `core/`, thin pages). Deliberately **skipped** for a single-team tool: audit logs, roles, per-user analytics, bulk import/export.
_(6.5 done 2026-07-07: `/admin` shell (h1 + client tab nav; per-page session gates — the layout is never the only auth check) with an owner-only Admin header link. Artifacts tab: searchable paginated table over the plain deterministic `listArtifacts` (not NL — admin is a tool), Open → the artifact page whose metadata editor stays the single edit surface (reuses `updateArtifactMetadata`; less code), confirm-dialog delete. Share-links tab: new `listAllShareLinks` join query in `core/sharing` (paginated, artifact title, status/expiry/views/last-viewed; token never recoverable), one-click revoke — previously revocation was per-artifact only. Comments tab: new `core/feedback/moderation.ts` (`listRecentComments` platform feed + `deleteComment` with `CommentNotFoundError`; deletion auto-stales the synthesis via comment-count). Shared `ConfirmActionButton` (Dialog + toast) and `AdminPagination`. All admin actions are idempotent on already-gone targets and gate the session before any core call. 8 new integration tests: list-all ordering/join/pagination, moderation feed, delete + double-delete domain error, each action's happy path, and a single auth-denial test proving all three actions redirect to /unlock with zero writes. Unauthenticated smoke: /admin/* leaks no content. `pnpm check` + 228 tests + `pnpm build` green.)_
- [x] `/admin` shell + nav (ai | artifacts | share links | comments)
- [x] Artifacts table: search, edit metadata (via the artifact page's editor, reusing `updateArtifactMetadata`), delete — integration tests
- [x] Platform-wide share-link table: new paginated `core/sharing` list-all query, expiry/access-count columns, one-click revoke — integration tests (revocation was per-artifact only before)
- [x] Comment moderation: recent-comments list + delete — new `core/feedback` moderation module + tests
- [ ] Tag management tile (rename/merge/delete across catalog; pairs with 6.7) — **cut candidate, skipped with 6.7 unless requested**

#### 6.6 Workflow friction removers (impact Med-High / effort S-M — never cut the first two)
- [ ] **Copy-paste MCP config panel**: UI panel with the exact remote-connector URL and the `claude_desktop_config.json` / `mcp-remote` snippet per §4.2, copy buttons, clear token placeholder handling (never render the real token into the snippet unless the unlocked owner session explicitly reveals it)
- [ ] **Re-run AI on an existing artifact**: owner button to regenerate metadata suggestions (same orchestration as publish; fills as editable "suggested" values via the existing `aiGeneratedMeta` badge mechanism) and to force feedback re-synthesis — both through existing guardrails/telemetry; unit + integration tests
- [ ] Empty states — folded into 6.1 (no separate work item)
- Known gap left cut: large web uploads (> ~3 MB function-body cap) still can't reach 25 MB from the browser; client-direct-to-Blob remains the documented follow-up (Decision Log 2026-07-06) — not reviewer-facing polish

#### 6.7 Tag normalization (impact Med / effort S — AI feature D, **first cut**)
Owner-triggered batch action (from the 6.5 tag tile): Haiku proposes lowercase/dedupe/merge of near-duplicate tags ("mockup"/"mockups"/"ui-mockup"); owner reviews and approves before anything mutates — never auto-applies. Guardrails + telemetry as usual; deterministic no-op fallback.
- [ ] `core/ai/tag-normalize.ts` + prompt + tests; apply step is a plain deterministic core function
- [ ] Approve/apply UI in the admin tag tile

#### 6.8 Extras
- [ ] **OG / social unfurl** (keep — S): `opengraph-image` + meta tags so a pasted share link unfurls with title/description/preview in chat tools — serves the core review loop directly. Must not leak beyond what the share token already grants; unfurl images for share URLs go through the token-verified path
- [ ] Dark-mode toggle — **cut** unless slack remains (tokens already exist)

#### 6.9 Image point-pin comments (impact Med / effort M — Tier 1)
Click a point on an `image`-kind preview → anchor `{type:"image-point", xPct, yPct}` (same `anchor` column/schema, additive variant), rendered as numbered markers. Images only.
_(Done 2026-07-07, built together with 6.4 — see the 6.4 note above for the full record.)_
- [x] Anchor schema variant + core/MCP/share-action round-trip tests
- [x] Pin UI on image viewer (owner + share view; numbered markers, pending-pin dot, pin→comment and chip→pin jumps)

**Accept (Phase 6):**
- Fresh non-technical visitor perceives a designed product (owner manual prod pass); shadcn is the actual component layer.
- Gallery shows real previews for HTML/SVG/PDF/markdown/text kinds with zero `/raw` sandbox/CSP regression.
- NL search returns correctly filtered results and silently falls back to raw FTS on AI failure/budget; `pnpm eval` includes a passing `nl-search` set.
- A text-quote-anchored comment round-trips core → REST → MCP → share view; null-anchor comments and old-shape API/MCP calls unaffected.
- `/admin` manages artifacts, lists + revokes share links platform-wide, deletes comments — each integration-tested (happy + failure/auth path).
- MCP-config panel and re-run-AI both work under existing guardrails/telemetry.
- All contracts intact; `pnpm check && pnpm test && pnpm build` green; `pnpm smoke` green against production.

### Phase 7 — Documentation & walkthrough support
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
| 2026-07-07 | Installed `@anthropic-ai/sdk` + `unpdf` for Phase 4 | The only new runtime deps. `@anthropic-ai/sdk` (0.110) is the official client; `unpdf` (pure-JS pdfjs) extracts first-pages PDF text so PDFs flow through the same "fence-as-data + head/tail cap" path as every other kind (uniform guardrails, deterministic evals, no vision cost). PDF bytes are `.slice()`-copied before extraction because pdfjs may transfer/detach the backing ArrayBuffer, which would corrupt the same buffer the artifact is stored from. |
| 2026-07-07 | Feature A web UX: generate-at-publish, edit-after (user decision) | The web publish form stays single-shot; blanks are filled server-side during `publishArtifact` (the same core path REST/MCP use), and the artifact page shows AI values as editable with a "suggested" badge. No new pre-publish suggest endpoint. `aiGeneratedMeta` is the audit record and the badge source: a field is badged only while its stored value still equals the AI suggestion, so editing it drops the badge without any extra state. |
| 2026-07-07 | Structured outputs as the schema-validation backbone; no `effort` on Haiku | `lib/ai/model.ts` calls `messages.create` with `output_config.format = {type:"json_schema", schema}` (loose schema: types + enums only — length/count caps are unsupported there and are enforced in the feature's Zod parser). Hand-built the JSON schema + validated with our own `zod` rather than the SDK's `zod/v4`-pinned `zodOutputFormat` helper, keeping validation/retry in our control. Haiku 4.5 rejects `output_config.effort`, so it is never sent; no `thinking` (short extraction tasks). |
| 2026-07-07 | `llm_calls.outcome` mapping | `ok` = first attempt schema-valid; `schema_retry_ok` = valid only after the one corrective retry; `fallback` = schema-invalid twice **or** daily budget tripped; `error` = model call threw. Every non-`ok` path still returns the deterministic fallback (publish/read never blocked). Budget-tripped rows carry a distinct `error` marker and are excluded from the budget count via `IS DISTINCT FROM` (a plain `<>` would drop the null-error normal rows, since `null <> 'x'` is null — this was a real bug caught by the budget test). |
| 2026-07-07 | Feedback-summary shape centralized in `lib/validation`; synthesis single-flight holds the connection during the LLM call | `feedbackSummarySchema`/`FeedbackSummary` moved to `lib/validation/feedback.ts` as the single source shared by core, the `feedback_summaries` jsonb column, the MCP outputSchema, and the UI; `core/feedback` re-exports the type for backward compat. `getOrCreateSynthesis` runs generation inside a `db.transaction` holding `pg_advisory_xact_lock(hashtext(id))`, so the txn's connection is held for the ~1–2 s Haiku call — acceptable at single-team scale; telemetry/budget use a separate pooled connection and are best-effort (failures swallowed). |
| 2026-07-07 | Public rate limiting stays **in-memory fixed-window + honeypot** for v1 (no durable counter) | The only public write is share-view commenting, and it is already token-gated to exactly one artifact (the id comes from the verified link, never the client). The honeypot silently drops bots; the fixed-window limiter throttles the common case (one spammer on one instance). On Fluid Compute the in-memory state isn't cross-instance, but at single-team scale that's an acceptable soft guarantee, not a security boundary. A durable KV/Postgres counter is the documented scale-out path, deliberately not built now (CLAUDE.md: less code is better). Noted in `lib/rate-limit.ts`. |
| 2026-07-07 | Seed reuses the **real core** (`sniffArtifact`, `createShareLink`) + Vercel Blob adapter, run via `tsx` | The seed must produce prod-faithful rows (blobs served through `/raw`, real signed share token), so it calls the same core the app uses rather than hand-writing inserts — single source of truth. Plain `node` can't resolve the `@/` alias in core's transitive imports (same constraint as `pnpm eval`), so `db:seed` runs under `tsx` (added as a devDependency; it honors tsconfig `paths`). Artifacts use **stable ids** so a re-run deletes+recreates exactly the demo set (idempotent); `--reset` additionally purges smoke-test noise (tag `smoke-test` / title `Smoke test …`) but never other artifacts. Binary kinds ship a self-encoded PNG (minimal RGBA encoder) and a byte-accurate one-page PDF from `src/db/seed-content.ts` — no external assets. |
| 2026-07-07 | Post-deploy smoke wired via GitHub `deployment_status`, not a deploy step in CI | Vercel owns deploys (git integration), so CI can't "deploy then smoke" in one job. Instead `.github/workflows/smoke.yml` listens for Vercel's `deployment_status` event and runs `pnpm smoke` against `target_url` when a **Production** deploy succeeds (with a `workflow_dispatch` manual path). Needs repo secrets `ADMIN_API_TOKEN` (+ `SMOKE_BASE_URL` fallback); skips gracefully if unset. |
| 2026-07-07 | `pnpm eval` is a separate vitest config, not a `node` script | The eval calls `src` functions whose transitive imports use the `@/` alias + directory/`.ts` resolution that plain `node` can't resolve; `vitest run --config vitest.eval.config.ts` resolves them. It stays fully separate from `pnpm test` (different config, `*.eval.ts` glob excluded from the unit/integration projects), so `pnpm test` never spends tokens. Integration tests inject a default invalid model caller in `setup.ts` so no `pnpm test` run ever hits the network. |
| 2026-07-07 | **Phase 6 (product polish) inserted; documentation phase renumbered to 7** | User decision after Phase 5: core works but doesn't feel like a polished product. Scope, priorities, and cut order in §8 Phase 6. Constraints: no breaking MCP/REST/share contract changes (additive-optional only), AI-invisible principle held, all non-UI work automated-test-provable. |
| 2026-07-07 | Live gallery previews via client-side render of `/raw/[id]` — **not** a thumbnail pipeline | Honors the cut-list "thumbnail generation pipeline" cut's intent (no worker, no sharp, no stored thumbnail bytes, no schema change) while replacing kind icons with real previews: the card scales down content the app already serves through the sandboxed `/raw` path (`pointer-events-none`, lazy). The cut-list future path (worker + sharp on upload) remains the answer if gallery-scale perf ever demands static thumbnails. |
| 2026-07-07 | NL search = LLM query→filter translation over existing FTS — **not** the cut embedding search | A Haiku pre-parser maps a natural-language query onto the filter structure `core/artifacts` search already supports (FTS terms, kind, tags, date range). No embeddings, no pgvector, no new retrieval infra, so the "semantic search" cut stands. Trivial/keyword queries bypass the LLM; any failure/budget-trip falls back to raw FTS with the original string. New `nl-search` eval set gates it like Features A/B. |
| 2026-07-07 | Gallery search: blank form params ("" ) = absent at the `listQuerySchema` boundary | The search box is a native GET form, so every submit sends all fields — `/?q=word&kind=` is the true shape of a UI search. The schema rejected `""` (not `undefined`) → ZodError → error boundary; **every form search crashed from Phase 1 until found 2026-07-07** (masked in earlier verification because curls/tests omitted the blank fields). All `listQuerySchema` fields now preprocess blank→undefined; invalid non-blank values still reject. Regression test pins the exact form shapes. |
| 2026-07-07 | SVG previews render via `<img>`, not an empty-sandbox iframe | An image decoding context is script-inert by spec — strictly stronger than `sandbox=""` (no frame exists at all), and it eliminates the "Blocked script execution" console noise caused by devtools browser extensions trying to inject hooks into the sandboxed SVG frame. `/raw` still serves SVG with the CSP `sandbox` directive, so direct navigation stays sandboxed. CLAUDE.md invariant + §2 table updated; the "SVG treated as active content" init decision is superseded for *embedding* (serving is unchanged). |
| 2026-07-07 | Anchored feedback shipped as text-quote Tier 0; HTML/SVG region-pins explicitly cut | Simplest version that's actually useful: `{type:"text-quote", quote, prefix?, suffix?}` in a nullable `comments.anchor` jsonb — additive-optional on REST/MCP, null = unanchored, no client breaks, re-location degrades gracefully to a plain quote. Region-pins inside HTML/SVG are cut because the `/raw` iframe is a security boundary: a postMessage coordinate channel from untrusted content is exactly the attack surface the sandbox exists to prevent. Image point-pins (`image-point` variant) are Tier 1, second-cut. |

## 12. Phase 0 → Phase 1 handoff

- **Local DB:** `docker compose up -d`, then `DATABASE_URL=postgres://artifact_hub:artifact_hub@localhost:5432/artifact_hub pnpm db:migrate` (matches `.env.example`). `docker compose down -v` resets the volume.
- **Gotcha:** `drizzle-kit migrate` hides real SQL errors behind its spinner — to debug, apply the migration with `psql -v ON_ERROR_STOP=1 < src/db/migrations/0000_*.sql`.
- **Gotcha:** `artifacts.search_vector` depends on the IMMUTABLE `artifact_search_document()` function hand-added to the top of `0000_*.sql`; if you nuke & regenerate migrations, re-add it (rationale in `schema.ts`).
- **Half-wired (intentional):** `lib/env.ts` and `db/index.ts` are lazy and imported nowhere yet — Phase 1 wires them into server entrypoints. `id`s are app-generated (Drizzle `$defaultFn`), so raw SQL inserts must supply `id`.
- **Already logged deviations:** deploy deferred (no Neon/Vercel/Blob); `shadcn` is a real dependency (globals.css imports its CSS); `core/` coverage gate only runs under `--coverage`.
- **Not built yet:** `/publish` route (gallery CTA links to it), all `core/` logic, MCP tools, blob adapter — Phase 1+.
