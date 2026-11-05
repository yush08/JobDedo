import Link from "next/link";
import { Clock3, History, Radar } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshJobsButton } from "./refresh-jobs-button";
import { relativeTime } from "@/lib/utils/format";
import type { OverviewData } from "@/lib/server/loaders";

/** Discovery refresh status card — shows only what actually happened. */
export function DiscoveryStatusCard({ discovery }: { discovery: OverviewData["discovery"] }) {
  const { latest, stale, ageMs, adaptersReady } = discovery;

  return (
    <Card className="card-shadow">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Radar className="size-4 text-primary" aria-hidden />
          Discovery status
        </CardTitle>
        <RefreshJobsButton adaptersReady={adaptersReady} />
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        {!latest ? (
          <div className="rounded-lg border border-dashed p-3">
            <p className="font-medium">No discovery runs yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {adaptersReady
                ? "Refresh to fetch real listings from the configured sources. Progress and per-source results are persisted."
                : "No discovery source is configured yet, so a run cannot start. Set DISCOVERY_GREENHOUSE_BOARDS, DISCOVERY_LEVER_POSTINGS or DISCOVERY_ASHBY_BOARDS."}
            </p>
            <Badge variant="outline" className="mt-2 text-[10px] text-warning">
              {adaptersReady ? "Ready to run" : "No source configured"}
            </Badge>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Last run</span>
              <span className="font-medium">{relativeTime(latest.started_at)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="outline" className="capitalize">
                {latest.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Found / new</span>
              <span className="tabular-nums">
                {latest.found_count} / {latest.new_count}
              </span>
            </div>
            {stale && (
              <p className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                <History className="size-3.5 shrink-0" aria-hidden />
                Results are stale
                {ageMs != null ? ` (last run ${relativeTime(latest.finished_at ?? latest.started_at)})` : ""}
                .
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" aria-hidden />
            {latest
              ? `Triggered by ${latest.trigger.replace("_", " ")}`
              : "Manual refresh only"}
          </span>
          <Link href="/discover">
            <Button variant="ghost" size="xs" className="h-auto px-1 text-primary">
              Open Discover →
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function UpcomingDeadlines({
  items,
}: {
  items: OverviewData["upcomingDeadlines"];
}) {
  return (
    <Card className="card-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Clock3 className="size-4 text-warning" aria-hidden />
          Upcoming deadlines
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            title="No deadlines in the next 30 days"
            description="Jobs with closing dates will appear here so you can plan applications."
            className="py-6"
          />
        ) : (
          <ul className="space-y-2.5">
            {items.map(({ job, daysLeft }) => (
              <li key={job.id}>
                <Link
                  href={`/discover/${job.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{job.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {job.company?.name ?? "Unknown company"}
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={daysLeft <= 3 ? "border-destructive/40 text-destructive" : "text-warning"}
                  >
                    {daysLeft === 0 ? "Today" : `${daysLeft}d`}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
