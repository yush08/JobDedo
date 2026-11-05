"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Radar,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  readRunPhase,
  readRunSources,
  useDiscoveryRunner,
} from "./use-discovery-runner";
import { formatDateTime, relativeTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { DiscoveryRun } from "@/types";

/**
 * Discovery control panel for the Discover page.
 *
 * Shows only what the server persisted: the last successful discovery, live
 * progress of an in-flight run, per-source success/failure with the actual
 * error text, and the run history. The Refresh / Retry button is the single
 * entry point for starting a run from this page.
 */
export function DiscoveryRunPanel({
  runs,
  ready,
}: {
  runs: DiscoveryRun[];
  ready: boolean;
}) {
  const { start, busy, run: liveRun, runs: liveRuns } = useDiscoveryRunner({
    runs,
    active: runs.some((r) => r.status === "pending" || r.status === "running"),
  });
  const [showHistory, setShowHistory] = useState(false);

  const history = liveRuns.length > 0 ? liveRuns : runs;
  const latest = liveRun ?? history[0] ?? null;
  const lastSuccess = history.find(
    (r) => r.status === "completed" && (r.finished_at ?? r.started_at),
  );
  const inFlight = busy || latest?.status === "pending" || latest?.status === "running";
  const sources = readRunSources(latest);
  const failedSources = sources.filter((s) => s.status !== "success");

  return (
    <Card className="card-shadow">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Radar className="size-4 text-primary" aria-hidden />
          Discovery runs
          {inFlight && (
            <Badge variant="outline" className="text-[10px] text-primary">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {readRunPhase(latest) || "running"}
            </Badge>
          )}
        </CardTitle>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void start()}
          disabled={busy}
          aria-label="Run discovery now"
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw aria-hidden />
          )}
          {busy ? "Discovering…" : latest?.status === "failed" ? "Retry discovery" : "Refresh jobs"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Last successful discovery — the "last updated" indicator. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Last successful discovery:{" "}
            <span className="font-medium text-foreground">
              {lastSuccess
                ? relativeTime(lastSuccess.finished_at ?? lastSuccess.started_at)
                : "never"}
            </span>
          </span>
          {lastSuccess && (
            <span className="hidden sm:inline">
              {formatDateTime(lastSuccess.finished_at ?? lastSuccess.started_at)}
            </span>
          )}
          <span>
            Runs recorded: <span className="font-medium text-foreground">{history.length}</span>
          </span>
        </div>

        {!ready && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <p>
              No discovery source is configured, so a run cannot start. Set{" "}
              <code className="rounded bg-muted px-1">DISCOVERY_GREENHOUSE_BOARDS</code>,{" "}
              <code className="rounded bg-muted px-1">DISCOVERY_LEVER_POSTINGS</code> or{" "}
              <code className="rounded bg-muted px-1">DISCOVERY_ASHBY_BOARDS</code>.
            </p>
          </div>
        )}

        {/* Live progress of the in-flight run. */}
        {inFlight && latest && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">
                {readRunPhase(latest) || "running"} ·{" "}
                {latest.status === "pending" ? "queued" : "in progress"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {latest.found_count} found · {latest.new_count} new ·{" "}
                {latest.duplicate_count} duplicates
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        )}

        {/* Per-source outcome: exactly which boards worked. */}
        {sources.length > 0 && !inFlight && (
          <ul className="space-y-2">
            {sources.map((source) => (
              <li
                key={source.source_key}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <SourceStatusIcon status={source.status} />
                  <span className="font-medium">{source.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {source.fetched} fetched · {source.created} new ·{" "}
                    {source.merged + source.deduplicated} duplicates
                    {source.invalid > 0 ? ` · ${source.invalid} invalid` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    source.status === "success" && "text-success",
                    source.status === "partial" && "text-warning",
                    source.status === "failure" && "text-destructive",
                  )}
                >
                  {source.status === "success"
                    ? "OK"
                    : source.status === "partial"
                      ? "Partial"
                      : "Failed"}
                </span>
                {source.failures.length > 0 && (
                  <p className="w-full text-[11px] break-words text-destructive">
                    {source.failures
                      .map((f) => `${f.target}: ${f.error}`)
                      .join(" · ")
                      .slice(0, 400)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Failure state with retry. */}
        {!inFlight && latest?.status === "failed" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
            <p>
              <span className="font-semibold">Last run failed.</span>{" "}
              {(latest.error || "No source returned data.").slice(0, 300)} Existing listings are
              untouched — retry whenever you like.
            </p>
          </div>
        )}

        {!inFlight && latest?.status === "completed" && failedSources.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <p>
              <span className="font-semibold">
                Completed with {failedSources.length} source
                {failedSources.length === 1 ? "" : "s"} failing.
              </span>{" "}
              Stored listings were kept and the failures are recorded above.
            </p>
          </div>
        )}

        {/* Run history (collapsed by default). */}
        {history.length > 0 && (
          <div className="border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
            >
              <History aria-hidden />
              Run history ({history.length})
              {showHistory ? (
                <ChevronUp className="size-3.5" aria-hidden />
              ) : (
                <ChevronDown className="size-3.5" aria-hidden />
              )}
            </Button>

            {showHistory && (
              <ul className="mt-2 space-y-1.5">
                {history.slice(0, 10).map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <RunStatusDot status={run.status} />
                      <span className="font-medium capitalize">{run.status}</span>
                      <span className="text-muted-foreground">{run.trigger}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {run.found_count} found · {run.new_count} new · {run.duplicate_count} dup
                    </span>
                    <span
                      className="text-muted-foreground"
                      title={formatDateTime(run.finished_at ?? run.started_at)}
                    >
                      {relativeTime(run.finished_at ?? run.started_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {history.length === 0 && !inFlight && (
          <EmptyState
            icon={Radar}
            title="No discovery runs yet"
            description={
              ready
                ? "Run a discovery to fetch real listings from the configured sources. Sample rows stay clearly labelled until then."
                : "Once a source is configured, your first run will appear here with per-source results."
            }
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}

function SourceStatusIcon({ status }: { status: "success" | "partial" | "failure" }) {
  if (status === "success") {
    return <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />;
  }
  if (status === "partial") {
    return <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />;
  }
  return <XCircle className="size-4 shrink-0 text-destructive" aria-hidden />;
}

function RunStatusDot({ status }: { status: DiscoveryRun["status"] }) {
  const tone =
    status === "completed"
      ? "bg-success"
      : status === "failed"
        ? "bg-destructive"
        : status === "cancelled"
          ? "bg-muted-foreground"
          : "bg-primary animate-pulse";
  return <span className={cn("size-2 shrink-0 rounded-full", tone)} aria-hidden />;
}
