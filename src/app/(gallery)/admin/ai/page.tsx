import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
          <p className="text-muted-foreground border-border rounded-xl border border-dashed px-4 py-8 text-center text-sm">
            No fallbacks or errors recorded.
          </p>
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">When</TableHead>
                    <TableHead scope="col">Feature</TableHead>
                    <TableHead scope="col">Outcome</TableHead>
                    <TableHead scope="col">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failures.map((f) => (
                    <TableRow key={`${f.feature}-${f.createdAt.toISOString()}`}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(f.createdAt)}
                      </TableCell>
                      <TableCell>{f.feature}</TableCell>
                      <TableCell>
                        <Badge variant={f.outcome === "error" ? "destructive" : "secondary"}>
                          {f.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{f.error ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
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
    <Card size="sm" className="gap-1">
      <p className="text-muted-foreground px-4 text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="px-4 text-xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function OutcomeChip({ label, value }: { label: string; value: number }) {
  return (
    <Badge variant="outline" className="gap-1.5 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </Badge>
  );
}
