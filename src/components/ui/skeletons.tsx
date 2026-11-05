import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/** Loading skeleton for a grid of job cards. */
export function JobGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="card-shadow">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="size-11 rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-14" />
            </div>
            <div className="mt-auto flex justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-7" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Loading skeleton for stat cards / dashboard sections. */
export function StatsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="card-shadow">
          <CardContent className="p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-14" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="card-shadow">
          <CardContent className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
