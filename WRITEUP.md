# Artifact Hub — Project Writeup

A platform for publishing, browsing, reviewing, and sharing AI-generated content (HTML, images, PDFs, Markdown, and more), with a web UI, a REST API, and a remote MCP server over one shared core. This document covers what was built, the decisions behind it, what was deliberately cut, and how quality is proven. Setup and operation live in [README.md](README.md); the demo script lives in [WALKTHROUGH.md](WALKTHROUGH.md); the full build history (phases, checklists, 40+ dated decisions) lives in [PLAN.md](PLAN.md).

## 1. The problem and the shape of the solution

Teams generate content with AI tools, then the lifecycle breaks: files sit behind CLI commands, get shared through expiring URLs pasted into chat, and feedback scatters across threads. Artifact Hub gives that content a home — a catalog with real previews, revocable time-limited share links for people outside the platform, structured comments that can point at the exact passage or pixel they're about, and AI that quietly synthesizes multi-reviewer feedback into consensus / disagreements / action items.

Four design principles, held throughout:

1. **A non-technical person can use it without instructions** — every flow was built and copy-edited for that person.
2. **AI is invisible infrastructure.** It pre-fills, translates, and synthesizes; it is never a "✨ AI" button that is the point of the screen. Every AI path has a deterministic fallback, so the product works identically when the model fails, the budget trips, or the API is down.
3. **Every capability is identical across UI, REST, and MCP** — one `core/`, one Zod schema set, three thin adapters.
4. **Polished core flows over broad surface** — the cut list (§7) is long on purpose.

## 2. Architecture

One Next.js deployable on Vercel. Postgres (Neon) for metadata/comments/links/telemetry; Vercel Blob (private store) for artifact bytes; the MCP server mounted at `/api/mcp` as stateless Streamable HTTP.

```
Web UI ──┐
REST ────┼──► core/ (artifacts, sharing, feedback, ai) ──► db/ (Drizzle/Postgres)
MCP  ────┘                                            └──► lib/storage (Vercel Blob)
                                                      └──► lib/ai (Anthropic + telemetry)
```

**Why a monolith:** one deploy target, one URL for reviewers, shared types end-to-end. The dependency rule (`app/` and `mcp/` depend on `core/`; `core/` depends on `lib/` + `db/`; nothing depends on `app/`) keeps a future split into services mechanical rather than a rewrite. The rule is real: route handlers and MCP tools contain parsing and mapping only — every behavior lives in `core/`, which is framework-free and unit-testable.

**Boundaries are typed.** Every external input — HTTP bodies, MCP tool args, LLM output, env vars, even the admin UI's approved-tag-merge JSON — passes a Zod schema at the boundary. The same `listQuerySchema` backs the gallery search box, `GET /api/v1/artifacts`, and the MCP `search_artifacts` tool.

### Content security model

Artifact content is untrusted input, always:

- **All bytes are served through `/raw/[id]`**, never from blob URLs (the store is private; a leaked URL 403s). `/raw` sets a per-kind `Content-Security-Policy` and `X-Content-Type-Options: nosniff`.
- **HTML** renders only inside `sandbox="allow-scripts"` iframes; the CSP blocks all network access (`connect-src 'none'`), so an artifact's scripts can run but cannot exfiltrate. The CSP `sandbox` directive also covers *direct navigation* to `/raw` — an opaque origin even outside an iframe.
- **SVG** renders via `<img>` — an image decoding context is script-inert by spec, strictly stronger than an empty-sandbox iframe (and it eliminated the "blocked script execution" console noise browser-extension injection caused in frames).
- **MIME is sniffed server-side** from magic bytes (plus a content classifier for text formats, which have none); the client's declared type never wins. Never `dangerouslySetInnerHTML` — even syntax highlighting was cut when the library required it (Decision Log 2026-07-05).

### Share links

Token = `linkId.signature` where the signature is HMAC-SHA256 over id + expiry — the expiry is *inside* the MAC, not a query param. The DB row stores only a hash of the token (a working URL is unrecoverable from the database or the admin UI), plus revocation state and access counters. Verification: constant-time signature check → DB lookup → expiry/revocation. A forged or guessed token only ever sees the ambiguous "invalid" page; the distinct expired/revoked pages are reachable only past the HMAC check, so they confirm nothing to strangers. Unfurl crawlers hitting a share link get title/description/OG-card through a `countAccess: false` verify — a Slack preview never counts as a view.

### Auth (deliberately minimal)

Single-team trust model: one `ADMIN_API_TOKEN` bearer for REST/MCP writes, exchanged once via a token-gate page for an httpOnly session cookie on the web. Comments need only a name — external review through share links is the core loop, and an account wall would kill it. Full accounts/SSO are cut (§7) because they'd spend a phase on plumbing that demonstrates nothing novel; `core/` is auth-agnostic, so accounts slot in at the adapter layer later.

## 3. MCP design

The server is **stateless Streamable HTTP** — a fresh `McpServer` + transport per request, no session state, which is exactly what serverless wants and gives full isolation between concurrent clients. Eight tools (`publish_artifact`, `search_artifacts`, `get_artifact`, `create_share_link`, `revoke_share_link`, `get_feedback`, `add_comment`, `hub_stats`) are thin wrappers over the same `core/` functions the UI calls.

Design choices worth defending:

- **Descriptions are written for an LLM operator**, not a human: purpose, when to reach for the tool, what comes back, and cross-tool workflow ("never guess an id — call `search_artifacts` first"). The server `instructions` field documents the publish → id → share/feedback flow.
- **Every error names the failure and the recovery path** in one sentence ("artifact `x1` not found — call `search_artifacts` to discover valid ids"). An LLM can self-correct from these; a bare 404 teaches it nothing.
- **Write tools require the bearer token; read tools are open** — matching the web model exactly.
- **Payload limits are honest about the platform.** Vercel caps request bodies at ~4.5 MB, so inline/base64 publishes are capped at ~3 MB decoded with a clear error, and larger binaries go through an SSRF-guarded `sourceUrl` fetch (https-only, resolved-IP validation against private/reserved/metadata ranges, redirect cap, 25 MB stream cap).
- **Additive evolution:** phase 6 added `anchor` to `add_comment`, `since` + opt-in `natural` to `search_artifacts` — all optional, no existing client breaks; the default `search_artifacts` path is byte-for-byte the original.

On SDK choice: the split `@modelcontextprotocol/server` 2.0 packages were still beta and re-churning, so the stable `@modelcontextprotocol/sdk` 1.x carries the endpoint — the boring choice, deliberately, under an auth-bearing route.

## 4. LLM usage — four features, one discipline

All model calls go through a single wrapper (`lib/ai/client.ts`) that enforces the same lifecycle: **budget check → schema-constrained call → validate → one corrective retry → deterministic fallback → exactly one telemetry row.** It never throws; no user flow is ever blocked by the AI. Model: Claude Haiku (fast/cheap; id centralized in one config file). Prompts are versioned modules (`metadata-gen@1`, `feedback-synthesis@2`, `nl-search@1`, `tag-normalize@1`) so telemetry and evals track regressions across prompt changes.

| Feature | What it does | Invisibility mechanism |
|---|---|---|
| **A — Auto-metadata** | Fills omitted title/description/tags at publish (text extraction per kind; vision for images; `unpdf` for PDFs) | Pre-filled editable fields with a subtle "suggested" badge that disappears once the value is edited; failure → filename-derived title |
| **B — Feedback synthesis** | At ≥2 comments: consensus, disagreements, action items, sentiment — every bullet cites the comment ids it draws from, rendered as links | Regenerates lazily on read when stale (Postgres advisory-lock single-flight); below threshold there is simply no card |
| **C — Natural-language search** | "html mockups with feedback from last week" → the structured filters FTS already supports (terms, kind, tags, since) | Same search box; short keyword queries bypass the model entirely; an over-narrowed translation that finds nothing silently re-runs the user's original words — provably never worse than raw FTS |
| **D — Tag normalization** | Proposes merges of near-duplicate tags ("mockups"/"ui-mockup" → "mockup") | Owner-triggered, suggest → review → apply; the model can only regroup tags it was shown, and nothing mutates without explicit approval through a deterministic apply function |

### Guardrails (uniform across features)

1. **Injection hardening:** artifact content, comments, search queries, and tag names are all fenced as data blocks with forgery-stripped sentinels; system prompts instruct the model to treat block contents purely as data; output schemas constrain the blast radius (short strings, enums, id-membership checks).
2. **Schema-validated outputs:** structured outputs pin the JSON shape; our own Zod/manual parsers enforce what structured outputs can't (length caps, enum membership, vocabulary membership, citation validity), with one retry then fallback.
3. **Input caps:** head+tail sampling for long documents, most-recent-50 comment batches, per-comment character caps.
4. **Cost ceiling:** a per-feature daily call budget (env-configurable); exceeded → fallback path + warning log, so a comment-spam loop can't cause runaway spend.

### Observability and evaluation

Every call writes an `llm_calls` row: feature, model, prompt version, tokens, latency, computed cost, outcome (`ok | schema_retry_ok | fallback | error`). `/admin/ai` renders 24h/7d call counts, cost, p50/p95 latency, outcome breakdown, and recent failures — small, honest, real.

`pnpm eval` runs golden datasets against the live model and fails CI below thresholds. Current scorecard (28 fixtures, real Haiku):

| Suite | Fixtures | Schema valid | Injection resistant | Quality metric |
|---|---|---|---|---|
| metadata-gen | 12 | **100%** | **100%** | avg tag overlap 68% (floor 30%) |
| feedback-synthesis | 8 | **100%** | **100%** | traceability 100%, expected-key coverage 100% |
| nl-search | 8 | **100%** | **100%** | filter accuracy 100% (kind/terms/time extraction) |

Every suite includes at least one live injection attempt (a document, a comment, and a search query that try to hijack the task); resistance is a hard 100% gate, not an average.

## 5. Product surface (what a reviewer actually sees)

- **Gallery** with live previews per kind — HTML renders in a scaled sandboxed iframe, PDFs show their first page, text kinds show a real snippet — built with *no* thumbnail pipeline: every card is a render of content already served through `/raw`.
- **Artifact page**: preview hero (with a Source tab for HTML/SVG), sticky metadata sidebar, share-link manager with live expiry countdowns and one-time token reveal, comments + synthesis card.
- **Anchored feedback**: select text in a document → "Comment on this" → the comment carries the quote and clicking it scrolls to and flashes the passage (CSS Custom Highlight API, graceful degradation); click a spot on an image → a numbered pin. HTML/SVG region-pins were explicitly cut: the sandbox iframe is a security boundary, and a postMessage coordinate channel from untrusted content is exactly the attack surface it exists to prevent.
- **Share view**: clean read-only page for outsiders with visible expiry, open commenting (name only), the same anchored-feedback tools, and friendly expired/revoked pages — never a 404.
- **Admin console**: AI observability, artifact management, a platform-wide share-link inventory with one-click revoke, comment moderation, and tag cleanup.
- **`/connect`**: copy-paste MCP onboarding for both connector styles, with placeholder-by-default token handling (the real token renders only for an unlocked owner who explicitly toggles it).
- Empty/loading/error states everywhere, toasts on every mutation, keyboard-reachable actions, AA contrast in light and dark themes.

## 6. Quality strategy

| Level | Mechanism |
|---|---|
| Static | TypeScript strict, Biome lint+format, no floating promises (type-aware rule), import-boundary respect |
| Unit + integration | **252 tests / 37 files**: `core/` logic pure-unit; every MCP tool and REST route exercised against a real Postgres with the model stubbed at the `lib/ai` boundary — happy path + failure path each, including auth denial with zero-writes assertions |
| LLM evals | §4 harness; CI-gated on PRs touching AI code |
| E2E smoke | Post-deploy script against production: gallery, REST publish, artifact render, MCP initialize + search round-trip, share create/resolve/revoke — wired to Vercel's `deployment_status` webhook |
| Runtime | pino structured logs, global error boundaries, API error envelope |

Two bugs this discipline caught are instructive. A Postgres null-comparison subtlety (`<>` vs `IS DISTINCT FROM`) would have silently exempted budget-tripped calls from the budget count — a test caught it. Conversely, the one bug that reached production — every form-driven search crashing because a native GET form submits `kind=""` and the schema rejected empty strings — survived because tests and curls omitted the blank fields a real form always sends. The fix treats blank as absent at the shared boundary, and the regression test now pins the exact form shapes. Lesson recorded: verify through the same surface the user touches.

## 7. Deliberate cuts

The point of the cut list is that each cut has a rationale and a future path — non-goals, not omissions:

| Cut | Why | Future path |
|---|---|---|
| User accounts / SSO / roles | Signed links + team token cover the access-control requirement without a phase of auth plumbing | Auth.js + orgs table at the adapter layer |
| Embedding/semantic search | Postgres FTS is right-sized at this catalog scale; NL search got the UX benefit by *translating queries into filters* instead of new retrieval infra | pgvector + hybrid rank |
| Artifact versioning | Publish-new beats version-tree complexity for the review loop | `artifact_versions` + text diff |
| HTML/SVG region-pin comments | Coordinate capture across the sandbox boundary = the attack surface the sandbox exists to prevent | postMessage protocol with a trusted overlay, designed deliberately |
| MCP OAuth 2.1 | Bearer is honest for single-team v1 | The Nov-2025 MCP auth spec |
| Thumbnail pipeline (worker + sharp) | Live scaled renders of already-served content carry the gallery | Static thumbnails if gallery scale demands |
| Notifications, realtime, OTel | Integration surface disproportionate to a single-team demo | Webhooks; websockets; OTel exporter |

Two cuts were later un-cut on request with the risk contained: the tag-management tile (built as suggest→approve→apply) and dark mode (the token set was AA-designed from the start, so it was wiring).

## 8. Deployment & operations

- **Vercel** (git integration deploys `main`); **Neon** Postgres; **private** Vercel Blob store. Secrets via env vars, validated by Zod at boot — missing config fails fast with a named message.
- Migrations are generated by drizzle-kit and applied explicitly (`pnpm db:migrate`); the integration suite applies them to a disposable DB on every run, so a migration that breaks is caught before prod.
- `pnpm db:seed` builds a realistic demo catalog through the *real* core (same sniffing, same blob adapter, real signed share link) — idempotent via stable ids, with `--reset` to sweep test noise.
- Post-deploy smoke runs automatically on production deployments via GitHub Actions listening to Vercel's `deployment_status` event.
- Rate limiting on the one public write (share-view comments): honeypot + fixed-window limiter, accepted as in-memory for v1 with the reasoning documented in code.

## 9. What I'd do next

1. **Client-direct-to-Blob web uploads** — the 25 MB server limit is unreachable through a function body (~3 MB cap); presigned client uploads close that honest gap.
2. **MCP authorization spec** — replace the bearer with the OAuth 2.1 resource-indicator flow once the ecosystem settles.
3. **Accounts + review routing** — the first cut worth reversing at multi-team scale; tags/kinds already carry the signal routing rules would need.
4. **DNS-pinning for `sourceUrl` fetches** — the one accepted TOCTOU residual in the SSRF guard, closable with a custom lookup-pinned agent.
5. **Durable rate limiting** — swap the in-memory window for a Postgres/KV counter when the trust model widens.

---

*Gates at the time of writing: `pnpm check`, 252 tests, `pnpm build`, `pnpm eval` (28 fixtures against live Haiku), and the production smoke script — all green.*
