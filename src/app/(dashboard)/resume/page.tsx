import { Suspense } from "react";
import type { Metadata } from "next";
import { ResumeWorkspace } from "./resume-workspace";

export const metadata: Metadata = {
  title: "Resume Studio",
};

export default function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<ResumeSkeleton />}>
      <ResumePageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ResumePageContent({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const projectId = Array.isArray(params.projectId)
    ? params.projectId[0]
    : params.projectId;

  return <ResumeWorkspace projectId={projectId} />;
}

function ResumeSkeleton() {
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
