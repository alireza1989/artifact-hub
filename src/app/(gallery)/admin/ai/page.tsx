import { redirect } from "next/navigation";
import { type AiWindowStats, getAiWindowStats, getRecentAiFailures } from "@/core/ai";
import { hasValidSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";

// AI observability (PLAN §5.4). Session-gated like every owner surface; all
// numbers come straight from the llm_calls telemetry table.
export const dynamic = "force-dynamic";

export default async function AdminAiPage() {
  if (!(await hasValidSession())) redirect("/unlock");

  const [day, week, failures] = await Promise.all([
    getAiWindowStats(24),
    getAiWindowStats(24 * 7),
    getRecentAiFailures(10),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AI observability</h1>
        <p className="text-muted-foreground text-sm">
          LLM calls, cost, latency, and outcomes from live telemetry.
        </p>
      </div>

      <WindowPanel title="Last 24 hours" stats={day} />
      <WindowPanel title="Last 7 days" stats={week} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Recent failures</h2>
        {failures.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No fallbacks or errors recorded.
          </p>
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr
                    key={`${f.feature}-${f.createdAt.toISOString()}`}
                    className="border-border border-b last:border-0"
                  >
                    <td className="text-muted-foreground whitespace-nowrap px-3 py-2">
                      {formatDate(f.createdAt)}
                    </td>
                    <td className="px-3 py-2">{f.feature}</td>
                    <td className="px-3 py-2">{f.outcome}</td>
                    <td className="text-muted-foreground px-3 py-2">{f.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function WindowPanel({ title, stats }: { title: string; stats: AiWindowStats }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Calls" value={stats.totalCalls.toLocaleString()} />
        <Tile label="Cost" value={`$${stats.totalCostUsd.toFixed(4)}`} />
        <Tile
          label="p50 latency"
          value={stats.p50LatencyMs != null ? `${stats.p50LatencyMs} ms` : "—"}
        />
        <Tile
          label="p95 latency"
          value={stats.p95LatencyMs != null ? `${stats.p95LatencyMs} ms` : "—"}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <OutcomeChip label="ok" value={stats.outcomes.ok} />
        <OutcomeChip label="schema_retry_ok" value={stats.outcomes.schema_retry_ok} />
        <OutcomeChip label="fallback" value={stats.outcomes.fallback} />
        <OutcomeChip label="error" value={stats.outcomes.error} />
      </div>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function OutcomeChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="border-border bg-muted/40 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}
