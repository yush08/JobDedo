import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Bookmark, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SampleDataBanner } from "@/components/jobs/sample-data-banner";
import { JobCard } from "@/components/jobs/job-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { JobGridSkeleton } from "@/components/ui/skeletons";
import { loadSavedJobs } from "@/lib/server/loaders";

export const metadata: Metadata = {
  title: "Saved Jobs",
};

export default function SavedPage() {
  return (
    <Suspense fallback={<SavedSkeleton />}>
      <SavedContent />
    </Suspense>
  );
}

async function SavedContent() {
  const jobs = await loadSavedJobs();
  const hasSample = jobs.some((j) => j.is_sample);

  return (
    <div>
      <PageHeader
        title="Saved Jobs"
        description="Your shortlist — every job you have bookmarked, ranked by match score with its verification record."
      />

      {hasSample && (
        <SampleDataBanner
          count={jobs.filter((j) => j.is_sample).length}
          realCount={jobs.filter((j) => !j.is_sample).length}
        />
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No saved jobs yet"
          description="Save jobs from Discover to build a shortlist here. Saved state is stored immediately — it never lives only in the browser."
          action={
            <Link href="/discover">
              <Button>
                <Search aria-hidden />
                Browse jobs
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-7 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted" />
      </div>
      <JobGridSkeleton count={6} />
    </div>
  );
}
