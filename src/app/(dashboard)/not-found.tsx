import Link from "next/link";
import { Compass, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Rendered when `notFound()` is thrown inside the dashboard (e.g. unknown job id). */
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <SearchX className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">Not found</h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        That record doesn&apos;t exist — it may have been deleted, or the link
        may be out of date.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/discover">
          <Button>
            <Compass aria-hidden />
            Discover jobs
          </Button>
        </Link>
        <Link href="/overview">
          <Button variant="outline">Back to Overview</Button>
        </Link>
      </div>
    </div>
  );
}
