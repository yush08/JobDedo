import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Dashboard statistic card. Values always come from real stored rows. */
export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary" | "success" | "warning";
}) {
  const tones = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
  } as const;

  return (
    <Card className="card-shadow">
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl leading-none font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          {note && <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p>}
        </div>
        {Icon && (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              tones[tone],
            )}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
        )}
      </CardContent>
    </Card>
  );
}
