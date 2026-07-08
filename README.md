# Artifact Hub

A platform for publishing, browsing, reviewing, and sharing AI-generated content
(HTML, images, PDFs, Markdown, CSVs, code, and more). One deployable Next.js app
exposing the **same capabilities three ways** — a web UI, a REST API, and a remote
**MCP server** — over a shared, framework-free core. LLM features (Claude Haiku)
pre-fill metadata on publish and synthesize scattered review comments into
consensus / disagreement / action items.

**Demo deployment:** <https://artifact-hub-murex.vercel.app>

**Demo team (admin) token** (`/unlock` for the web UI, bearer for REST/MCP writes — published deliberately for this demo since there's no per-user auth):

```
jYVPlXAWzhk16NcZ+wWTnjwSzqJUwlq9b5r/DG9cU0Dx+jLTCAs4I6+QwGanPfdq
```

See [`PLAN.md`](./PLAN.md) for scope, architecture, and the decision log, and
[`CLAUDE.md`](./CLAUDE.md) for the development operating manual.

## What it does

- **Publish** any file (web upload, REST, or conversationally via MCP). Type is
  sniffed server-side from magic bytes; missing title/description/tags are filled
  by AI and shown as editable "suggested" values (re-runnable any time).
- **Browse** a visual gallery with **live per-kind previews** on every card, plus
  search that understands both keywords and natural language ("html mockups with
  feedback from last week") with tag/type/date filters.
- **Preview** every kind safely — HTML in a locked-down sandboxed iframe (with a
  Source tab), SVG via script-inert `<img>`, images inline, PDFs in the native
  viewer, Markdown sanitized, CSV as a table, JSON/code in read-only viewers.
- **Share** via revocable, time-limited, HMAC-signed links that work for people
  outside the team, unfurl with a branded card when pasted into chat, and can be
  revoked one-by-one or from a platform-wide admin inventory.
- **Review** with comments that can **anchor to a text selection or a pixel on an
  image**; artifacts with ≥2 comments get an AI synthesis card whose bullets link
  back to the comments they cite.
- **Administer** at `/admin`: AI telemetry (calls/cost/latency/outcomes), artifact
  management, share-link inventory, comment moderation, and AI-assisted tag
  cleanup (suggest → review → apply).
- **MCP** so Claude Desktop and other MCP clients can publish, search, share, and
  read/leave feedback in natural conversation — copy-paste setup at `/connect`.

## Architecture

### System & infrastructure

```mermaid
flowchart LR
    subgraph Clients
        B["Browser<br/>(team + external reviewers)"]
        C["Claude Desktop / MCP clients"]
        A["API clients"]
        S["Slack / chat unfurl crawlers"]
    end

    subgraph Vercel["Vercel (one Next.js deployable)"]
        UI["Web UI<br/>app/(gallery), share/[token]"]
        REST["REST API<br/>app/api/v1"]
        MCP["MCP server<br/>app/api/mcp<br/>stateless Streamable HTTP"]
        RAW["/raw/[id]<br/>content serving + CSP"]
        CORE["core/<br/>artifacts · sharing · feedback · ai"]
        UI --> CORE
        REST --> CORE
        MCP --> CORE
        RAW --> CORE
    end

    B --> UI
    B --> RAW
    S --> UI
    C --> MCP
    A --> REST

    CORE --> NEON[("Neon Postgres<br/>metadata · comments · links · llm_calls")]
    CORE --> BLOB[("Vercel Blob<br/>private store — artifact bytes")]
    CORE --> ANTH["Anthropic API<br/>Claude Haiku"]

    GH["GitHub Actions<br/>CI: check + test + build<br/>eval on AI changes<br/>smoke after prod deploy"] -.-> Vercel
```

### Module dependency rule

```mermaid
flowchart TD
    APP["app/  (pages, server actions, REST routes)"] --> CORE
    MCPD["mcp/  (tool definitions)"] --> CORE
    CORE["core/  — ALL business logic, framework-free"] --> LIB["lib/  (ai · storage · validation · env · auth)"]
    CORE --> DB["db/  (Drizzle schema · migrations · seed)"]
    APP --> LIB
    MCPD --> LIB
```

All business logic lives in **framework-free `core/` modules** consumed by three
thin adapters (UI server components/actions, REST routes, MCP tools). Validation
schemas in `lib/validation` are shared across all three. `core/` never imports
`app/` — that boundary keeps the surfaces honest and the logic unit-testable. If
logic appears in a route handler or tool handler, it moves to `core/`.

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

## Core workflows

### Publish (any surface) with invisible AI

```mermaid
sequenceDiagram
    actor U as User / Claude / API client
    participant AD as Adapter (UI action · REST · MCP tool)
    participant P as core/artifacts.publishArtifact
    participant AI as lib/ai (Haiku)
    participant BL as Vercel Blob
    participant DB as Postgres

    U->>AD: file/content (+ optional metadata)
    AD->>AD: Zod-validate at the boundary
    AD->>P: bytes + metadata
    P->>P: sniff MIME from magic bytes (client type never trusted)
    alt title/description/tags omitted
        P->>AI: fenced content → suggest metadata
        alt model ok (schema-valid)
            AI-->>P: {title, description, tags}
        else fallback / budget / error
            AI-->>P: nothing — filename-derived title
        end
        Note over AI,DB: exactly one llm_calls telemetry row either way
    end
    P->>BL: store bytes (private)
    P->>DB: insert artifact (+ aiGeneratedMeta audit)
    AD-->>U: artifact id + which fields were AI-filled
    Note over U: UI shows "suggested" badges — editing a field clears its badge
```

### Share → external review → synthesis (the core loop)

```mermaid
sequenceDiagram
    actor O as Owner
    actor R as External reviewer
    participant APP as App
    participant DB as Postgres
    participant AI as lib/ai (Haiku)

    O->>APP: create share link (1h…30d)
    APP->>DB: store token HASH + expiry
    APP-->>O: full URL — one-time reveal
    O->>R: paste link (unfurls with OG card, view not counted)
    R->>APP: open /share/token
    APP->>APP: constant-time HMAC check → expiry/revocation → count view
    R->>APP: select text / click image spot → anchored comment (name only)
    Note over APP: ≥2 comments → next read triggers synthesis
    O->>APP: open artifact page
    APP->>AI: fenced comment batch (advisory-lock single-flight)
    AI-->>APP: consensus · disagreements · action items — bullets cite comment ids
    O->>APP: revoke link — reviewer now sees a friendly "turned off" page
```

### Search: keywords stay cheap, natural language gets translated

```mermaid
flowchart TD
    Q["search box / MCP q"] --> H{"≥4 words or a question?"}
    H -- no --> FTS["Postgres FTS<br/>websearch_to_tsquery + filters"]
    H -- yes --> T["Haiku: query → {terms, kind, tags, since}"]
    T -- schema-valid --> M["merge — explicit user filters always win"] --> RUN["run translated search"]
    T -- "fallback / budget / error" --> FTS
    RUN -- "0 results" --> FTS
    RUN -- results --> OUT["results"]
    FTS --> OUT
```

Every LLM feature follows the same lifecycle: **budget check → schema-constrained
call → validate → one retry → deterministic fallback → one telemetry row**
(`lib/ai/client.ts`). No user flow ever blocks on the model.

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

The web UI is gated by a team token: visit `/unlock` and enter your
`ADMIN_API_TOKEN` once (stored as an httpOnly cookie). Every page — browsing,
artifact detail, publish, admin — requires it; the only public surfaces are
share-link pages (`/share/<token>`, which also authorize the content they embed
via `?st=` on `/raw`) and the REST/MCP read operations.

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
`revoke_share_link`) require the bearer token. The in-app **`/connect`** page
renders these same instructions with copy buttons.

> **Demo team token** (this is a demo deployment without user accounts — the
> single team token is intentionally published so reviewers can exercise the
> write tools):
>
> ```
> jYVPlXAWzhk16NcZ+wWTnjwSzqJUwlq9b5r/DG9cU0Dx+jLTCAs4I6+QwGanPfdq
> ```
>
> It is also the `/unlock` token for the web UI's publish/admin features.

There are three ways to connect:

**1. Custom connector (claude.ai / Claude Desktop → Settings → Connectors →
"Add custom connector").** Use URL `https://artifact-hub-murex.vercel.app/api/mcp`.
If your client supports custom headers, add
`Authorization: Bearer <token>` to enable the write tools; with a URL-only
connector the read/search/feedback tools still work (writes will ask you to
connect with the token).

**2. Claude Code (one command — it speaks Streamable HTTP natively, no bridge):**

```bash
claude mcp add --transport http artifact-hub \
  https://artifact-hub-murex.vercel.app/api/mcp \
  --header "Authorization: Bearer jYVPlXAWzhk16NcZ+wWTnjwSzqJUwlq9b5r/DG9cU0Dx+jLTCAs4I6+QwGanPfdq"
```

Add `--scope user` to register it across all your projects (default is the
current project only). Verify with `claude mcp list`, or `/mcp` inside a Claude
Code session — then try *"search the artifact hub for the pricing mockup"*.

**3. `mcp-remote` bridge (Claude Desktop / any stdio client, full write access).**
Bridge with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) in
`claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit
Config):

```json
{
  "mcpServers": {
    "artifact-hub": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://artifact-hub-murex.vercel.app/api/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer jYVPlXAWzhk16NcZ+wWTnjwSzqJUwlq9b5r/DG9cU0Dx+jLTCAs4I6+QwGanPfdq"
      }
    }
  }
}
```

> Note the header arg is `Authorization:${AUTH_HEADER}` with **no space after the
> colon**, and the value rides in `env`: Claude Desktop passes args verbatim (it
> does no `${}` interpolation and mishandles spaces inside args); `mcp-remote`
> performs the substitution itself. Restart Claude Desktop after editing, then
> check the tools icon — eight `artifact-hub` tools should be listed.

Once connected, a reviewer flow reads naturally: *"publish this HTML → share it
for 72 hours → any feedback yet?"* maps to `publish_artifact` → `create_share_link`
→ `get_feedback`. Every tool error names the failure **and** the recovery step.
[`WALKTHROUGH.md`](./WALKTHROUGH.md) has a full demo script and a feature-by-
feature test checklist.

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

### Security architecture

```mermaid
flowchart TD
    subgraph Untrusted["Untrusted input"]
        UP["uploads<br/>(any bytes)"]
        CM["comments + anchors"]
        QY["search queries"]
        LLM["LLM output"]
    end

    UP --> SNIFF["server-side MIME sniff<br/>magic bytes + text classifier<br/>+ 25 MB cap"]
    SNIFF --> BLOB[("private Blob store<br/>URLs never given to clients")]
    BLOB --> RAW["/raw/[id]<br/>per-kind CSP + nosniff"]
    RAW -- HTML --> IFR["iframe sandbox=allow-scripts<br/>CSP: connect-src 'none'<br/>no allow-same-origin"]
    RAW -- SVG --> IMG["&lt;img&gt; — image context,<br/>script-inert by spec"]
    RAW -- "direct navigation" --> SBX["CSP sandbox directive<br/>→ opaque origin anyway"]

    CM --> ZOD1["Zod at boundary"] --> FENCE
    QY --> ZOD2["Zod at boundary"] --> FENCE["fenced data blocks,<br/>forged sentinels stripped"]
    FENCE --> MODEL["Haiku"]
    MODEL --> LLM
    LLM --> PARSE["schema parse + caps +<br/>enum/id/vocabulary membership<br/>→ retry once → fallback"]

    subgraph AuthZ["Write authorization"]
        TOK["ADMIN_API_TOKEN bearer<br/>(REST/MCP) · httpOnly session (web)"]
        SHT["share token = linkId.HMAC(id+expiry)<br/>hash-only storage · constant-time compare<br/>DB row → revocation"]
    end
```

- **Untrusted content is contained.** HTML renders only inside `sandbox`
  iframes pointed at `/raw/[id]`, which serves a per-kind Content-Security-Policy
  (`connect-src 'none'` so scripts can't exfiltrate, no `allow-same-origin`) plus
  `X-Content-Type-Options: nosniff`; SVG renders via `<img>` (script-inert image
  context — strictly stronger than an empty-sandbox frame). Artifact content is
  never `dangerouslySetInnerHTML`.
- **Share tokens** are `linkId.HMAC-SHA256(linkId.expiry, SHARE_LINK_SECRET)`,
  compared in constant time, backed by a DB row for revocation; only the token
  hash is stored, and full tokens are never logged.
- **Writes are bearer-gated** (constant-time check) on REST and MCP, before any
  core call; REST/MCP reads stay open, but web pages and `/raw/[id]` content
  require the unlocked session (or bearer token), with share links (`?st=`)
  authorizing exactly their one artifact.
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

## Roadmap — what a full product would add

For reviewers: this is a deliberately scoped v1 (see the cut list in
[`PLAN.md`](./PLAN.md) §9 for the reasoning behind each omission). The items
below are the path from "polished demo" to "comprehensive product", roughly in
the order I'd build them. `core/` is auth-agnostic and framework-free, so none
of these require a rewrite — they slot in at the adapter or schema layer.

| Area | What & why | Notes |
|---|---|---|
| **RBAC / accounts** | Real users (Auth.js or Neon Auth), orgs/teams, and roles (owner · editor · reviewer · viewer) replacing the single team token. Per-artifact ownership and permissions. | The biggest unlock — most items below depend on knowing *who* someone is. Auth checks already sit at the adapter layer, so core is untouched. |
| **Mentions & notifications** | `@name` in comments, review requests ("assign this to Dana"), and notify via email/Slack webhook on mention, new comment, or synthesis change. | Needs accounts first. The comment pipeline already stores structured data (anchors) — mentions are one more parsed field. |
| **Security hardening** | MCP OAuth 2.1 (resource indicators) instead of a static bearer; short-lived scoped share tokens with per-viewer identity; durable (KV/Postgres) rate limiting; DNS-pinned `sourceUrl` fetches (the one accepted TOCTOU residual); audit log of admin/destructive actions; CSP nonces on the app shell; secret rotation runbook. | The demo token published above is the single biggest thing RBAC + OAuth removes. |
| **Editing & versioning** | Replace-file and edit-in-place (for text kinds) producing an `artifact_versions` history with diffs between versions; comments pinned to the version they were made on; "outdated" markers on anchors whose passage changed. | The anchor re-location machinery (quote + prefix/suffix) was built with this in mind — a moved quote already degrades gracefully. |
| **Large uploads** | Client-direct-to-Blob (presigned) so the web form reaches the full 25 MB instead of ~4 MB, plus resumable uploads and configurable caps. | Tracked in the Decision Log since Phase 2. |
| **Review workflow** | Review states (open → changes requested → approved), resolvable comment threads, reviewer checklists, and routing rules (tag/kind → default reviewers). | Synthesis already extracts action items — states make them actionable. |
| **Search at scale** | pgvector embeddings + hybrid ranking once the catalog outgrows FTS; "similar artifacts"; saved searches. | The NL-search translator stays — it would emit hybrid queries instead. |
| **Collections & organization** | Folders/collections, pinned artifacts, bulk operations (tag, delete, export), and a JSON/ZIP export for portability. | |
| **Deeper observability** | OpenTelemetry traces across adapter → core → model calls, structured request logs shipped to a collector, uptime alerts on the smoke script. | `llm_calls` + pino cover the demo honestly; OTel is the production step. |
| **MCP surface growth** | Tools for the newer features (anchored comments exist; add tag cleanup, admin listing), MCP resources for artifact content, and prompts/templates for common review flows. | Additive-only, as with every MCP change so far. |

## Maintaining & extending

Recipes for the changes you're most likely to make, and the gotchas that will
bite if you don't know them.

### Add a new AI feature

1. Create a versioned prompt module `src/lib/ai/prompts/<name>.v1.ts` exporting
   the version string (`<name>@1`), system prompt, a *loose* JSON schema (types +
   enums only — structured outputs ignores length/count caps), a fenced
   instruction builder, and a strict parser that enforces everything the schema
   can't. Copy `nl-search.v1.ts` as the template.
2. Register the feature id in `AI_FEATURE_MODELS` (`src/lib/ai/config.ts`).
3. Compose it in `core/ai/<name>.ts` via `runFeature(...)` — budget, retry,
   fallback, and telemetry come for free. **Always define a deterministic
   fallback**; no flow may block on the model.
4. Tests: unit-test the parser (including an injection/forgery case); integration
   tests stub the model with `setModelCallerForTesting`. If the feature is
   user-visible quality-critical, add a golden set under `tests/evals/fixtures/`
   and wire it into `tests/evals/run.eval.ts`.
5. Bump the prompt version string on **any** prompt/template change.

### Add an MCP tool

Create `src/mcp/tools/<name>.ts` (Zod `inputSchema` reusing `lib/validation`
where possible, `outputSchema`, a description written for an LLM operator,
error text that names the recovery step), register it in `src/mcp/index.ts`,
wrap an existing `core/` function — never put logic in the tool. Add integration
tests via the in-memory harness (`tests/integration/mcp-harness.ts`): happy path
+ one failure path (+ auth denial if it writes).

### Add an artifact kind

Extend the `kind` enum in `src/db/schema.ts` + `ARTIFACT_KINDS` in
`lib/validation`; teach the sniffer (`core/artifacts/sniff.ts`); pick a CSP class
in `app/raw/[id]/route.ts` (active vs passive); add preview renderers in
`components/artifacts/preview/` and a card preview in `card-preview.tsx`; add
extraction for AI metadata in `core/ai/extract.ts`. Generate a migration.

### Migrations

`pnpm db:generate` after schema changes; `pnpm db:migrate` applies (integration
tests auto-apply to their disposable DB, so a broken migration fails the suite).
**Prod is migrated explicitly** — run `pnpm db:migrate` (the repo `.env` targets
prod) before deploying code that reads new columns.

### Gotchas (each learned the hard way — see PLAN Decision Log)

- **Two DB drivers.** Neon endpoints use the Neon serverless driver; local/tests
  use postgres.js. Query-builder results are uniform, but raw
  `db.execute(sql\`...\`)` differs (`RowList` vs `{ rows }`) — always unwrap with
  `rowsOf()` from `@/db`, or it will pass every test and crash only on prod.
- **`.env` points at production.** `pnpm db:seed`, `pnpm smoke`, `pnpm db:migrate`
  and anything loading `dotenv/config` from the repo root hit prod. Local dev
  uses `.env.local` (docker Postgres).
- **Blank form fields are absence.** Native GET forms submit every field, so
  boundary schemas must treat `""` as "not provided" (`listQuerySchema` does).
  Verify features through the same surface the user touches.
- **`artifacts.search_vector`** depends on the hand-written IMMUTABLE
  `artifact_search_document()` function at the top of migration `0000` — if you
  ever regenerate migrations from scratch, re-add it (rationale in `schema.ts`).
- **The web session cookie is per-hostname** — on preview deploys, `/unlock` and
  the page you're testing must be on the same host.
- **`pnpm eval` costs real tokens** (it calls live Haiku); `pnpm test` never does
  (the model is stubbed in setup).
