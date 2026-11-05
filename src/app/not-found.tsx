import Link from "next/link";
import { Compass, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Root-level 44 page (outside the dashboard shell). */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <SearchX className="size-6" aria-hidden />
      </span>
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        404
      </p>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        The page you are looking for doesn&apos;t exist or may have moved.
      </p>
      <Link href="/overview" className="mt-5">
        <Button>
          <Compass aria-hidden />
          Go to Overview
        </Button>
      </Link>
    </div>
  );
}
