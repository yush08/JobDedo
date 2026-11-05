"use client";

import { useState } from "react";

import { JobCard } from "./job-card";
import { JobFilters } from "./job-filters";
import { JobPagination } from "./job-pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchX } from "lucide-react";
import type { JobWithRelations, Paginated } from "@/types";

/**
 * Client wrapper that owns the grid/list toggle (a local UI preference);
 * all other filter state lives in the URL.
 */
export function DiscoverResults({
  results,
  roles,
  companies,
}: {
  results: Paginated<JobWithRelations>;
  roles: string[];
  companies: string[];
}) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  return (
    <>
      <JobFilters
        roles={roles}
        companies={companies}
        layout={layout}
        onLayoutChange={setLayout}
      />

      {results.items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No jobs match these filters"
          description="Clear a filter or widen your search — or tick/untick “Show sample rows” to switch between sample and discovered listings."
        />
      ) : (
        <div
          className={
            layout === "grid"
              ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              : "flex flex-col gap-3"
          }
        >
          {results.items.map((job) => (
            <JobCard key={job.id} job={job} layout={layout} />
          ))}
        </div>
      )}

      <JobPagination
        page={results.page}
        pageSize={results.pageSize}
        total={results.total}
      />
    </>
  );
}
