import type { ApplicationStage } from "@/types";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/utils/format";

const TONES: Record<ApplicationStage, string> = {
  discovered: "border-border bg-muted text-muted-foreground",
  shortlisted: "border-primary/30 bg-primary/10 text-primary",
  resume_prepared: "border-primary/30 bg-primary/10 text-primary",
  ready_for_approval: "border-warning/30 bg-warning/10 text-warning",
  applied: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  recruiter_contacted: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  interview: "border-success/30 bg-success/10 text-success",
  offer: "border-success/30 bg-success/10 text-success",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  withdrawn: "border-border bg-muted text-muted-foreground",
};

export function StageBadge({
  stage,
  className,
}: {
  stage: ApplicationStage;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONES[stage],
        className,
      )}
    >
      {titleCase(stage)}
    </span>
  );
}
