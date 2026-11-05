import { FlaskConical } from "lucide-react";

/**
 * Prominent banner shown wherever sample listings are visible.
 * Sample rows are always badged individually too — they must never read as
 * real job postings, and they are excluded from production statistics.
 */
export function SampleDataBanner({
  count,
  realCount = 0,
}: {
  count: number;
  /** Real discovered listings stored alongside the sample rows. */
  realCount?: number;
}) {
  if (count <= 0) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="text-foreground/90">
        <span className="font-semibold">
          {count} sample listing{count === 1 ? "" : "s"} loaded.
        </span>{" "}
        {realCount > 0
          ? `They sit next to ${realCount} real discovered listing${realCount === 1 ? "" : "s"} and are excluded from every production statistic.`
          : "No discovery run has completed yet, so these fictional rows are the only listings in the app — they exist to explore the interface."}{" "}
        Sample rows are badged{" "}
        <span className="rounded border bg-background px-1 text-[10px] font-bold tracking-wider text-warning">
          SAMPLE
        </span>{" "}
        and never carry source links or discovery timestamps.
      </p>
    </div>
  );
}
