import { pathToFileURL } from "node:url";
import { and, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { sniffArtifact } from "@/core/artifacts/sniff";
import { createShareLink } from "@/core/sharing";
import { getStorage, type Storage } from "@/lib/storage";
import type { ShareDuration } from "@/lib/validation";
import { getDb } from "./index";
import { artifacts, comments } from "./schema";
import { barChartPng, simplePdf } from "./seed-content";

// Idempotent demo seed (PLAN §7). Populates the hub with ~8 realistic artifacts
// across every preview kind — tags, review comments (several sets ≥3 so the
// feedback-synthesis card appears), and one active share link.
//
// Idempotency: every demo artifact has a STABLE id, so a re-run deletes and
// recreates exactly the demo set (cascading its comments + links). Anything you
// published by hand is untouched.
//
// `--reset` additionally clears the post-deploy smoke script's leftovers
// (title "Smoke test …", tag "smoke-test") so prod can be returned to a clean
// demo state. It never touches other artifacts. See PLAN §8 / README.
//
// Run: `pnpm db:seed` (or `pnpm db:seed --reset`). Requires the same env as the
// app (DATABASE_URL, BLOB_READ_WRITE_TOKEN, SHARE_LINK_SECRET, APP_BASE_URL).

type DemoComment = { author: string; body: string; hoursAfter: number };

type DemoArtifact = {
  id: string;
  filename: string;
  content: string | Uint8Array;
  declaredContentType?: string;
  title: string;
  description: string;
  tags: string[];
  source: "web" | "mcp" | "api";
  daysAgo: number;
  comments?: DemoComment[];
  share?: ShareDuration;
};

const HTML_LANDING = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nimbus — Ship faster</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; }
  .hero { padding: 96px 24px; text-align: center; background: linear-gradient(135deg, #eff6ff, #ffffff); }
  .hero h1 { font-size: 44px; margin: 0 0 16px; letter-spacing: -0.02em; }
  .hero p { font-size: 18px; color: #475569; max-width: 560px; margin: 0 auto 32px; }
  .cta { display: inline-block; background: #2563eb; color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; }
  .features { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); max-width: 960px; margin: 64px auto; padding: 0 24px; }
  .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
  .card h3 { margin: 0 0 8px; }
  .card p { margin: 0; color: #64748b; font-size: 15px; }
</style>
</head>
<body>
  <section class="hero">
    <h1>Ship features, not tickets</h1>
    <p>Nimbus turns your roadmap into shipped work. Plan, build, and launch from one place your whole team actually enjoys using.</p>
    <a class="cta" href="#">Start free trial</a>
  </section>
  <section class="features">
    <div class="card"><h3>Roadmaps</h3><p>Drag-and-drop planning that stays in sync with delivery.</p></div>
    <div class="card"><h3>Automations</h3><p>Route work, nudge owners, and close the loop without busywork.</p></div>
    <div class="card"><h3>Insights</h3><p>See cycle time and throughput without building a single report.</p></div>
  </section>
</body>
</html>
`;

const CHECKOUT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect width="640" height="200" fill="#f8fafc"/>
  <g fill="#dbeafe" stroke="#2563eb" stroke-width="2">
    <rect x="24" y="76" width="120" height="48" rx="8"/>
    <rect x="200" y="76" width="120" height="48" rx="8"/>
    <rect x="376" y="76" width="120" height="48" rx="8"/>
    <rect x="536" y="76" width="80" height="48" rx="8"/>
  </g>
  <g fill="#1e3a8a" font-size="14" text-anchor="middle">
    <text x="84" y="105">Cart</text>
    <text x="260" y="105">Address</text>
    <text x="436" y="105">Payment</text>
    <text x="576" y="105">Done</text>
  </g>
  <g stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)">
    <line x1="144" y1="100" x2="200" y2="100"/>
    <line x1="320" y1="100" x2="376" y2="100"/>
    <line x1="496" y1="100" x2="536" y2="100"/>
  </g>
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#94a3b8"/>
    </marker>
  </defs>
  <text x="24" y="40" font-size="18" font-weight="700" fill="#0f172a">Checkout flow — happy path</text>
</svg>
`;

const MIGRATION_MD = `# API v2 Migration Guide

The v1 REST API is deprecated and will be removed on **2026-10-01**. This guide
covers the breaking changes and how to migrate.

## What changed

- **Auth:** \`X-Api-Key\` header is replaced by \`Authorization: Bearer <token>\`.
- **Pagination:** offset/limit is replaced by cursor pagination (\`cursor\` + \`next\`).
- **Timestamps:** all timestamps are now ISO 8601 in UTC (was Unix seconds).

## Migration steps

1. Rotate your key to a v2 token in **Settings → API**.
2. Swap the auth header on every request.
3. Replace \`?offset=\` loops with cursor following:

\`\`\`
GET /v2/orders?limit=50
→ { "data": [...], "next": "eyJpZCI6..." }
GET /v2/orders?limit=50&cursor=eyJpZCI6...
\`\`\`

4. Update timestamp parsing to expect ISO strings.

## Need help?

Reach out in #api-support. We can extend your v1 access case-by-case through Q4.
`;

const ETL_PY = `#!/usr/bin/env python3
"""Nightly ETL: pull orders, roll up by region, write the warehouse table."""
import datetime as dt
import logging

from warehouse import connect, upsert

log = logging.getLogger("etl.orders")


def rollup(rows):
    totals = {}
    for row in rows:
        region = row["region"] or "unknown"
        totals[region] = totals.get(region, 0) + row["amount_cents"]
    return totals


def main():
    since = dt.date.today() - dt.timedelta(days=1)
    with connect() as db:
        rows = db.query("select region, amount_cents from orders where day = %s", since)
        totals = rollup(rows)
        upsert("revenue_by_region", day=since, totals=totals)
        log.info("wrote %d regions for %s", len(totals), since)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
`;

const FLAGS_JSON = `{
  "checkout_v2": { "enabled": true, "rollout": 1.0, "owner": "growth" },
  "new_onboarding": { "enabled": true, "rollout": 0.25, "owner": "activation" },
  "ai_summaries": { "enabled": false, "rollout": 0.0, "owner": "platform" },
  "referral_program": { "enabled": true, "rollout": 0.5, "owner": "growth" },
  "dark_mode": { "enabled": true, "rollout": 1.0, "owner": "design" }
}
`;

const SALES_CSV = `region,quarter,new_customers,revenue_usd,churn_rate
North America,Q1,412,1284500,0.031
Europe,Q1,318,986200,0.028
Asia Pacific,Q1,201,542300,0.044
Latin America,Q1,96,201800,0.052
Middle East & Africa,Q1,54,118400,0.039
`;

const BOARD_PDF = simplePdf([
  "Northstar Inc. — Q1 2026 Board Report",
  "",
  "Summary: ARR reached $12.4M, up 18% quarter over quarter.",
  "Net revenue retention held at 114%. Gross margin improved to 78%.",
  "",
  "Highlights",
  "- Enterprise segment closed 9 new logos (target: 7).",
  "- Checkout v2 lifted conversion 6.3% in the rollout cohort.",
  "- Cash runway: 21 months at the current burn.",
  "",
  "Risks",
  "- APAC churn rose to 4.4%; a retention workstream is staffed.",
  "- Hiring is 2 roles behind plan on the platform team.",
]);

const USERS_CHART = barChartPng([180, 240, 210, 320, 380, 300, 440]);

const DEMO_ARTIFACTS: DemoArtifact[] = [
  {
    id: "seed-html-landing",
    filename: "nimbus-landing.html",
    content: HTML_LANDING,
    title: "Nimbus — Q3 launch landing page",
    description: "Hero + feature mockup for the Nimbus launch. First pass for design review.",
    tags: ["mockup", "landing-page", "marketing"],
    source: "web",
    daysAgo: 9,
    share: "7d",
    comments: [
      {
        author: "Priya (Design)",
        body: "Hero reads well. The headline is strong — but 'Ship features, not tickets' may confuse folks who don't live in Jira. Worth A/B testing against something more outcome-focused.",
        hoursAfter: 3,
      },
      {
        author: "Marcus (PM)",
        body: "Agree the hero is the strongest part. I'd cut the trial CTA color down a notch — that blue fights the gradient. Otherwise the three-card layout is exactly the structure we discussed.",
        hoursAfter: 20,
      },
      {
        author: "Dana (Marketing)",
        body: "Love the cards. One ask: the CTA should say what happens next ('Start free trial — no card needed'). Also +1 on rethinking the headline, it's a little insider-y.",
        hoursAfter: 27,
      },
      {
        author: "Sam (Eng)",
        body: "Layout is clean and responsive already. Nothing blocking from my side — ship the copy tweaks and this is good to build.",
        hoursAfter: 44,
      },
    ],
  },
  {
    id: "seed-image-users",
    filename: "weekly-active-users.png",
    content: USERS_CHART,
    title: "Weekly active users — last 7 weeks",
    description:
      "WAU trend exported from the growth dashboard. Up and to the right after the onboarding change.",
    tags: ["analytics", "chart", "growth"],
    source: "web",
    daysAgo: 7,
    comments: [
      {
        author: "Marcus (PM)",
        body: "That week-4 jump lines up with the new onboarding going to 25%. Can we annotate the launch date on the chart before it goes in the deck?",
        hoursAfter: 5,
      },
      {
        author: "Priya (Design)",
        body: "Nice and legible. For the board version I'd add axis labels and a title inside the image so it stands alone.",
        hoursAfter: 30,
      },
    ],
  },
  {
    id: "seed-svg-checkout",
    filename: "checkout-flow.svg",
    content: CHECKOUT_SVG,
    title: "Checkout flow diagram — happy path",
    description: "Four-step checkout as it exists today. Reference for the v2 conversion work.",
    tags: ["diagram", "architecture", "checkout"],
    source: "mcp",
    daysAgo: 6,
    comments: [
      {
        author: "Sam (Eng)",
        body: "Accurate for the current flow. The v2 work collapses Address + Payment into one step — want me to add a second diagram for the target state?",
        hoursAfter: 8,
      },
    ],
  },
  {
    id: "seed-pdf-board",
    filename: "q1-2026-board-report.pdf",
    content: BOARD_PDF,
    title: "Q1 2026 board report",
    description:
      "Board deck narrative — ARR, retention, highlights, and risks. Draft for review before Thursday.",
    tags: ["report", "finance", "board"],
    source: "api",
    daysAgo: 5,
    comments: [
      {
        author: "Dana (Marketing)",
        body: "Numbers look great. I'd lead with NRR at 114% — that's the headline for this board, more than the ARR growth.",
        hoursAfter: 4,
      },
      {
        author: "Marcus (PM)",
        body: "The APAC churn risk is real but we should pair it with the retention workstream owner and a date, otherwise it reads as unmanaged.",
        hoursAfter: 9,
      },
      {
        author: "Priya (Design)",
        body: "Agree with Dana on leading with NRR. One nit: 'up 18% quarter over quarter' — double-check that's QoQ and not YoY, the last deck said YoY.",
        hoursAfter: 26,
      },
    ],
  },
  {
    id: "seed-markdown-migration",
    filename: "api-v2-migration.md",
    content: MIGRATION_MD,
    title: "API v2 migration guide",
    description:
      "Breaking changes from v1 to v2 (auth, pagination, timestamps) and step-by-step migration.",
    tags: ["docs", "api", "migration"],
    source: "mcp",
    daysAgo: 4,
    comments: [
      {
        author: "Sam (Eng)",
        body: "Clear. Can we add a concrete before/after code sample for the auth header swap? That's the change most people will trip on.",
        hoursAfter: 6,
      },
    ],
  },
  {
    id: "seed-code-etl",
    filename: "etl_orders.py",
    content: ETL_PY,
    declaredContentType: "text/x-python",
    title: "Nightly order ETL script",
    description:
      "Pulls yesterday's orders, rolls up revenue by region, and upserts the warehouse table.",
    tags: ["script", "ops", "data"],
    source: "api",
    daysAgo: 3,
    comments: [
      {
        author: "Sam (Eng)",
        body: "Solid. rollup() treats a null region as 'unknown' which is right. Add a retry around connect() before this goes on the nightly cron.",
        hoursAfter: 7,
      },
    ],
  },
  {
    id: "seed-json-flags",
    filename: "feature-flags.json",
    content: FLAGS_JSON,
    title: "Feature flags — current rollout state",
    description: "Snapshot of production feature flags with rollout percentages and owning team.",
    tags: ["config", "feature-flags", "platform"],
    source: "mcp",
    daysAgo: 2,
  },
  {
    id: "seed-csv-sales",
    filename: "q1-sales-by-region.csv",
    content: SALES_CSV,
    title: "Q1 sales by region",
    description:
      "New customers, revenue, and churn by region for Q1. Source data for the board report chart.",
    tags: ["data", "sales", "finance"],
    source: "web",
    daysAgo: 1,
    comments: [
      {
        author: "Dana (Marketing)",
        body: "MEA churn at 5.2% stands out — small base, but worth a footnote so the board doesn't over-read it.",
        hoursAfter: 2,
      },
      {
        author: "Marcus (PM)",
        body: "Can we add a total row? The board will want the blended numbers without doing mental math.",
        hoursAfter: 5,
      },
      {
        author: "Priya (Design)",
        body: "+1 on a total row. And sort by revenue descending so the story reads top-to-bottom.",
        hoursAfter: 8,
      },
    ],
  },
];

const SEED_IDS = DEMO_ARTIFACTS.map((a) => a.id);

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

// Remove artifacts by id, deleting their blobs first (best-effort) then the rows
// (cascade clears comments, links, and summaries). Returns the count removed.
async function purgeArtifacts(
  ids: string[],
  storage: Storage,
  log: (msg: string) => void,
): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const rows = await db
    .select({ id: artifacts.id, blobUrl: artifacts.blobUrl })
    .from(artifacts)
    .where(inArray(artifacts.id, ids));

  for (const row of rows) {
    try {
      await storage.delete(row.blobUrl);
    } catch (error) {
      log(`  · could not delete blob for ${row.id} (ignored): ${String(error)}`);
    }
  }
  await db.delete(artifacts).where(inArray(artifacts.id, ids));
  return rows.length;
}

export type SeedOptions = {
  reset?: boolean;
  storage?: Storage;
  log?: (msg: string) => void;
};

export type SeedResult = {
  artifactCount: number;
  commentCount: number;
  shareUrl?: string;
  smokeRemoved: number;
};

export async function seed(options: SeedOptions = {}): Promise<SeedResult> {
  const storage = options.storage ?? getStorage();
  const log = options.log ?? (() => {});
  const db = getDb();

  let smokeRemoved = 0;
  if (options.reset) {
    // Post-deploy smoke leftovers: tagged "smoke-test" or titled "Smoke test …".
    const smoke = await db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          or(
            sql`${artifacts.tags} @> ARRAY['smoke-test']::text[]`,
            ilike(artifacts.title, "Smoke test %"),
          ),
          // Never treat a demo row as smoke noise, even if it were tagged so.
          notInArray(artifacts.id, SEED_IDS),
        ),
      );
    smokeRemoved = await purgeArtifacts(
      smoke.map((r) => r.id),
      storage,
      log,
    );
    if (smokeRemoved > 0) log(`Reset: removed ${smokeRemoved} smoke-test artifact(s).`);
  }

  // Idempotent: clear any prior demo rows, then recreate the full set.
  await purgeArtifacts(SEED_IDS, storage, log);

  let commentCount = 0;
  let shareUrl: string | undefined;

  for (const demo of DEMO_ARTIFACTS) {
    const bytes = toBytes(demo.content);
    const { contentType, kind } = await sniffArtifact({
      bytes,
      filename: demo.filename,
      declaredContentType: demo.declaredContentType,
    });
    const { url } = await storage.put(`${demo.id}/${demo.filename}`, bytes, contentType);
    const createdAt = new Date(Date.now() - demo.daysAgo * 86_400_000);

    await db.insert(artifacts).values({
      id: demo.id,
      title: demo.title,
      description: demo.description,
      contentType,
      kind,
      tags: demo.tags,
      blobUrl: url,
      sizeBytes: bytes.length,
      source: demo.source,
      aiGeneratedMeta: null,
      createdAt,
      updatedAt: createdAt,
    });

    for (const comment of demo.comments ?? []) {
      await db.insert(comments).values({
        artifactId: demo.id,
        authorName: comment.author,
        body: comment.body,
        createdAt: new Date(createdAt.getTime() + comment.hoursAfter * 3_600_000),
      });
      commentCount++;
    }

    if (demo.share) {
      const link = await createShareLink(demo.id, demo.share);
      shareUrl = link.url;
    }

    log(`  ✓ ${kind.padEnd(9)}${demo.title}`);
  }

  return { artifactCount: DEMO_ARTIFACTS.length, commentCount, shareUrl, smokeRemoved };
}

// CLI entry — only when invoked directly (not when imported by a test).
async function main(): Promise<void> {
  await import("dotenv/config");
  const reset = process.argv.includes("--reset");
  const log = (msg: string) => console.log(msg);

  console.log(reset ? "Seeding demo data (with smoke-test reset)…\n" : "Seeding demo data…\n");
  const result = await seed({ reset, log });

  console.log(`\nDone. ${result.artifactCount} artifacts, ${result.commentCount} comments seeded.`);
  if (result.shareUrl) {
    // The token is shown once (only its hash is stored). Grab it now to demo the
    // share flow.
    console.log(`\nActive share link (7 days):\n  ${result.shareUrl}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
