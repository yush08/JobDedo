import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { ListChecks, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ApplicationRow } from "@/components/applications/application-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { loadApplications } from "@/lib/server/loaders";
import { APPLICATION_STAGES, type ApplicationStage } from "@/types";
import { titleCase } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Applications",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function ApplicationsPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  return (
    <Suspense fallback={<ApplicationsSkeleton />}>
      <ApplicationsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ApplicationsContent({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const stageFilter = typeof params.stage === "string" ? params.stage : "";
  const { applications } = await loadApplications();

  const filtered = stageFilter
    ? applications.filter((a) => a.stage === stageFilter)
    : applications;

  const counts = new Map<ApplicationStage, number>();
  for (const app of applications) {
    counts.set(app.stage, (counts.get(app.stage) ?? 0) + 1);
  }

  const activeStages = APPLICATION_STAGES.filter((s) => counts.has(s));

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Every tracked opportunity with its stage history. Stage moves are explicit actions and are never rewritten — history is append-only."
      />

      {applications.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No applications tracked yet"
          description="Open a job in Discover and use “Track application” to add it here. JobDedo will never mark an application as submitted without your confirmation."
          action={
            <Link href="/discover">
              <Button>
                <Search aria-hidden />
                Find jobs to track
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Stage filter chips */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by stage">
            <Link href="/applications">
              <Badge
                variant={stageFilter === "" ? "default" : "outline"}
                className="cursor-pointer px-2.5 py-1 text-[11px]"
              >
                All ({applications.length})
              </Badge>
            </Link>
            {activeStages.map((stage) => (
              <Link key={stage} href={`/applications?stage=${stage}`}>
                <Badge
                  variant={stageFilter === stage ? "default" : "outline"}
                  className="cursor-pointer px-2.5 py-1 text-[11px]"
                >
                  {titleCase(stage)} ({counts.get(stage)})
                </Badge>
              </Link>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={`No applications in “${stageFilter ? titleCase(stageFilter) : ""}”`}
              description="Pick another stage or clear the filter."
              className="py-8"
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((application) => (
                <ApplicationRow key={application.id} application={application} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApplicationsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
