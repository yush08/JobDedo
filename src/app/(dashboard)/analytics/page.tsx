import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { BarChart3, Info } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { SampleDataBanner } from "@/components/jobs/sample-data-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadAnalytics } from "@/lib/server/loaders";
import { AnalyticsCharts } from "@/components/dashboard/analytics-charts";
import {
  BadgeCheck,
  Bookmark,
  Briefcase,
  CalendarCheck,
  FileText,
  Sparkles,
  Target,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Analytics",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function AnalyticsPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AnalyticsContent({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  // Demo rows are excluded on request so sample data never reads as activity.
  const includeSample = params.sample !== "false";
  const summary = await loadAnalytics(includeSample);
  const t = summary.totals;

  const sampleNote =
    t.sample_jobs > 0 && includeSample
      ? `Includes ${t.sample_jobs} clearly-labelled sample rows.`
      : null;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Computed strictly from rows that exist in storage. Nothing here is estimated, invented or back-filled."
        actions={
          <Link href={includeSample ? "/analytics?sample=false" : "/analytics"}>
            <Button variant="outline">
              {includeSample ? "Hide sample rows" : "Show sample rows"}
            </Button>
          </Link>
        }
      />

      {sampleNote && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>{sampleNote} Toggle them off with the button above.</p>
        </div>
      )}
      {!includeSample && t.sample_jobs > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            Sample rows are hidden. The numbers below now reflect only your own
            stored activity.
          </p>
        </div>
      )}

      {t.jobs_discovered === 0 && t.applications_submitted === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No activity to chart yet"
          description="Analytics appear once you discover jobs or track applications. JobDedo never invents numbers to fill this page."
          action={
            <Link href="/discover">
              <Button>Discover jobs</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Jobs discovered"
              value={t.jobs_discovered}
              note={t.sample_jobs > 0 ? `${t.real_jobs} real` : "stored rows"}
              icon={Briefcase}
            />
            <StatCard
              label="Strong matches"
              value={t.strong_matches}
              note="score ≥ 75"
              icon={Sparkles}
              tone="primary"
            />
            <StatCard
              label="Verified"
              value={t.verified}
              note="strong evidence"
              icon={BadgeCheck}
              tone="success"
            />
            <StatCard
              label="Saved"
              value={t.saved}
              icon={Bookmark}
            />
            <StatCard
              label="Applications"
              value={t.applications_submitted}
              note="confirmed"
              icon={CalendarCheck}
              tone="primary"
            />
            <StatCard
              label="Interviews"
              value={t.interviews}
              note={`${summary.interview_conversion}% of applied`}
              icon={Target}
              tone="success"
            />
          </div>

          <AnalyticsCharts summary={summary} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ConversionCard
              title="Interview rate"
              value={t.applications_submitted > 0 ? summary.interview_conversion : null}
              detail={`${t.interviews} of ${t.applications_submitted} applications`}
            />
            <ConversionCard
              title="Offer rate"
              value={t.applications_submitted > 0 ? summary.offer_conversion : null}
              detail={`${t.offers} of ${t.applications_submitted} applications`}
            />
            <ConversionCard
              title="Response / pipeline"
              value={
                t.applications_submitted > 0
                  ? Math.round(
                      ((t.interviews + t.offers) / t.applications_submitted) * 100,
                    )
                  : null
              }
              detail="Interviews + offers vs submitted"
            />
            <ConversionCard
              title="Rejections"
              value={t.applications_submitted > 0 ? t.rejections : null}
              detail={`${t.rejections} recorded · ${t.offers} offers`}
              raw
            />
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            These are your pipeline numbers, not an employer&apos;s ATS score or a
            hiring probability. Resume and ATS analysis arrive in Milestone 5.
          </p>
        </div>
      )}
    </div>
  );
}

function ConversionCard({
  title,
  value,
  detail,
  raw = false,
}: {
  title: string;
  value: number | null;
  detail: string;
  raw?: boolean;
}) {
  return (
    <Card className="card-shadow">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">
          {value === null ? (
            <span className="text-muted-foreground">—</span>
          ) : raw ? (
            value
          ) : (
            `${value}%`
          )}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
        {value === null && (
          <Badge variant="outline" className="mt-2 text-[10px] text-muted-foreground">
            No applications yet
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
