import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Globe, Radar, ShieldCheck, PlugZap } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SampleDataBanner } from "@/components/jobs/sample-data-banner";
import { DiscoverResults } from "@/components/jobs/discover-results";
import { RefreshJobsButton } from "@/components/dashboard/refresh-jobs-button";
import { DiscoveryRunPanel } from "@/components/discovery/discovery-run-panel";
import { JobGridSkeleton } from "@/components/ui/skeletons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { loadJobsPage } from "@/lib/server/loaders";
import { discoveryReady, listDiscoveryAdapters } from "@/features/discovery/service";
import { getDataStore } from "@/lib/db";
import { DISCOVERY_SOURCES } from "@/lib/validation/schemas";

export const metadata: Metadata = {
  title: "Discover Jobs",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const IMPLEMENTED = new Set<string>(DISCOVERY_SOURCES);

export default function DiscoverPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<DiscoverSkeleton />}>
      <DiscoverContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DiscoverContent({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const { page, facets, hasSample, jobCount, sampleCount } = await loadJobsPage(params);
  const store = getDataStore();
  const [adapters, runs] = await Promise.all([
    Promise.resolve(listDiscoveryAdapters()),
    store.listDiscoveryRuns(10),
  ]);
  const ready = discoveryReady();
  const realCount = jobCount - sampleCount;

  return (
    <div>
      <PageHeader
        title="Discover Jobs"
        description="Stored opportunities ranked by fit with your profile, each with a transparent verification record."
        actions={<RefreshJobsButton adaptersReady={ready} size="default" />}
      />

      {hasSample && <SampleDataBanner count={sampleCount} realCount={realCount} />}

      {hasSample && runs.length === 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Radar className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-semibold">No discovery run yet.</span> The list below contains
            only clearly labelled sample rows until you run a discovery. JobDedo will not
            simulate a background refresh.
          </p>
        </div>
      )}

      {realCount > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {realCount} real listing{realCount === 1 ? "" : "s"} discovered
          {hasSample ? ` · ${jobCount} sample row${jobCount === 1 ? "" : "s"} still shown` : ""}.
          Sample rows are excluded from all production statistics.
        </p>
      )}

      <div className="mb-5">
        <DiscoveryRunPanel runs={runs} ready={ready} />
      </div>

      <DiscoverResults
        results={page}
        roles={facets.roles}
        companies={facets.companies}
      />

      {/* Source-level status: exactly what can and cannot run today. */}
      <section aria-labelledby="sources-heading" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="sources-heading" className="text-[15px] font-semibold tracking-tight">
            Sources
          </h2>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {adapters.filter((a) => a.enabled).length}/{adapters.length} enabled
          </Badge>
        </div>

        <Card className="card-shadow">
          <CardContent className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {adapters.map((adapter) => (
              <div
                key={adapter.key}
                title={adapter.status}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  {adapter.enabled ? (
                    <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
                  ) : IMPLEMENTED.has(adapter.key) ? (
                    <PlugZap className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate font-medium">{adapter.name}</span>
                </span>
                <span
                  className={`shrink-0 text-[11px] ${
                    adapter.enabled
                      ? "text-success"
                      : IMPLEMENTED.has(adapter.key)
                        ? "text-warning"
                        : "text-muted-foreground"
                  }`}
                >
                  {adapter.enabled ? "Ready" : IMPLEMENTED.has(adapter.key) ? "No targets" : "Not integrated"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="size-3.5" aria-hidden />
          JobDedo only reads official public JSON endpoints (Greenhouse, Lever, Ashby) — never
          login walls, CAPTCHAs or anti-bot protection. Sources without a permitted feed are
          listed as not integrated. See{" "}
          <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
            Settings → Discovery status
          </Link>
        </p>
      </section>
    </div>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-32 animate-pulse rounded-xl border bg-card" />
      <JobGridSkeleton count={6} />
    </div>
  );
}
