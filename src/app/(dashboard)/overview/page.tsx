import Link from "next/link";
import { Suspense } from "react";
import {
  BadgeCheck,
  Bookmark,
  Briefcase,
  CalendarCheck,
  Radar,
  Sparkles,
} from "lucide-react";

import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  DiscoveryStatusCard,
  UpcomingDeadlines,
} from "@/components/dashboard/discovery-status";
import { JobCard } from "@/components/jobs/job-card";
import { SampleDataBanner } from "@/components/jobs/sample-data-banner";
import { StageBadge } from "@/components/applications/stage-badge";
import { RefreshJobsButton } from "@/components/dashboard/refresh-jobs-button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  JobGridSkeleton,
  SectionSkeleton,
  StatsSkeleton,
} from "@/components/ui/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { loadOverview } from "@/lib/server/loaders";
import { relativeTime, formatDate } from "@/lib/utils/format";
import type { JobWithRelations } from "@/types";

export const metadata: Metadata = {
  title: "Overview",
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function SectionTitle({
  title,
  href,
  linkLabel = "View all",
}: {
  title: string;
  href: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <Link href={href}>
        <Button variant="ghost" size="xs" className="text-primary">
          {linkLabel} →
        </Button>
      </Link>
    </div>
  );
}

function JobRow({ jobs, empty }: { jobs: JobWithRelations[]; empty: string }) {
  if (jobs.length === 0) {
    return <EmptyState title={empty} className="py-8" />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent />
    </Suspense>
  );
}

async function OverviewContent() {
  const data = await loadOverview();
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${data.firstName}`}
        description={`${today} · Your personal job discovery and application assistant.`}
        actions={<RefreshJobsButton adaptersReady={data.discovery.adaptersReady} size="default" />}
      />

      {data.analyticsNote.hasSample && (
        <SampleDataBanner count={data.stats.sample_jobs} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Jobs discovered"
          value={data.stats.jobs_discovered}
          note={
            data.analyticsNote.hasSample
              ? `incl. ${data.analyticsNote.sampleCount} sample rows`
              : "from storage"
          }
          icon={Briefcase}
        />
        <StatCard
          label="Strong matches"
          value={data.stats.strong_matches}
          note="score ≥ 75"
          icon={Sparkles}
          tone="primary"
        />
        <StatCard
          label="Verified"
          value={data.stats.verified}
          note="strong evidence only"
          icon={BadgeCheck}
          tone="success"
        />
        <StatCard
          label="Saved jobs"
          value={data.stats.saved}
          icon={Bookmark}
        />
        <StatCard
          label="Applications"
          value={data.stats.applications_submitted}
          note="confirmed submissions"
          icon={CalendarCheck}
          tone="primary"
        />
        <StatCard
          label="Follow-ups due"
          value={data.stats.follow_ups_due}
          note="next 7 days"
          icon={CalendarCheck}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section aria-labelledby="recommended-heading">
            <div id="recommended-heading">
              <SectionTitle title="Recommended for you" href="/discover?sort=best_match" />
            </div>
            <JobRow
              jobs={data.recommended}
              empty="No recommendations yet — complete your Master Profile and Preferences."
            />
          </section>

          <section aria-labelledby="recent-heading">
            <div id="recent-heading">
              <SectionTitle title="Recently discovered" href="/discover?sort=recently_discovered" />
            </div>
            <JobRow
              jobs={data.recentlyDiscovered}
              empty="Nothing discovered yet."
            />
          </section>

          <section aria-labelledby="internships-heading">
            <div id="internships-heading">
              <SectionTitle
                title="Best matching internships"
                href="/discover?employment_type=internship&sort=best_match"
                linkLabel="All internships"
              />
            </div>
            <JobRow
              jobs={data.topInternships}
              empty="No internships match right now."
            />
          </section>
        </div>

        <div className="space-y-6">
          <DiscoveryStatusCard discovery={data.discovery} />
          <UpcomingDeadlines items={data.upcomingDeadlines} />

          <Card className="card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <Radar className="size-4 text-primary" aria-hidden />
                  Application activity
                </span>
                <Link href="/applications">
                  <Button variant="ghost" size="xs" className="h-auto px-1 text-primary">
                    Open →
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.applications.length === 0 ? (
                <EmptyState
                  title="No applications tracked yet"
                  description="Track an application from a job's details page to see activity here."
                  className="py-6"
                />
              ) : (
                <ul className="space-y-2.5">
                  {data.applications.map((app) => (
                    <li key={app.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {app.job_title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {app.company_name} · {relativeTime(app.updated_at)}
                        </span>
                      </span>
                      <StageBadge stage={app.stage} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="card-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm font-semibold">
                <span>Saved jobs</span>
                <Link href="/saved">
                  <Button variant="ghost" size="xs" className="h-auto px-1 text-primary">
                    All →
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {data.savedJobs.length === 0 ? (
                <EmptyState
                  title="No saved jobs"
                  description="Save jobs from Discover to shortlist them here."
                  className="py-6"
                />
              ) : (
                data.savedJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/discover/${job.id}`}
                    className="block rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block truncate text-sm font-medium">{job.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {job.company?.name ?? "Unknown"} ·{" "}
                      {job.closing_date ? `closes ${formatDate(job.closing_date)}` : "no deadline"}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-64 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
      </div>
      <StatsSkeleton count={6} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <div className="mb-3 h-4 w-44 animate-pulse rounded bg-muted" />
            <JobGridSkeleton count={4} />
          </div>
          <div>
            <div className="mb-3 h-4 w-44 animate-pulse rounded bg-muted" />
            <JobGridSkeleton count={2} />
          </div>
        </div>
        <div className="space-y-6">
          <SectionSkeleton />
        </div>
      </div>
    </div>
  );
}
