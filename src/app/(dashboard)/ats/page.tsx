import { Suspense } from "react";
import type { Metadata } from "next";

import { AtsClient } from "./ats-client";

export const metadata: Metadata = {
  title: "ATS Analyzer",
};

export default function AtsPage() {
  return (
    <Suspense fallback={<AtsSkeleton />}>
      <AtsClient />
    </Suspense>
  );
}

function AtsSkeleton() {
  return (
    <div className="flex flex-col h-full gap-4">
      <div className="animate-pulse rounded-lg bg-muted w-64 h-12" />
      <div className="flex-1 flex gap-4">
        <div className="flex-1 animate-pulse rounded-lg bg-muted h-48" />
        <div className="flex-1 animate-pulse rounded-lg bg-muted h-64" />
      </div>
    </div>
  );
}