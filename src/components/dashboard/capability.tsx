import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Honest capability block used by the milestone pages (Resume Studio, ATS,
 * Cold Email). It states exactly what exists today, what is stubbed behind a
 * real endpoint, and what is planned — never implying a feature works when it
 * does not.
 */

export interface EndpointContract {
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  status: "ready" | "stub" | "planned";
  description: string;
}

const STATUS_META: Record<
  EndpointContract["status"],
  { label: string; className: string }
> = {
  ready: {
    label: "Live",
    className: "border-success/40 bg-success/10 text-success",
  },
  stub: {
    label: "501 · not implemented",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  planned: {
    label: "Planned",
    className: "border-border bg-muted text-muted-foreground",
  },
};

export function EndpointList({ endpoints }: { endpoints: EndpointContract[] }) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {endpoints.map((ep) => (
        <li
          key={`${ep.method} ${ep.path}`}
          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 font-mono text-[10px]",
                ep.method === "GET" && "border-primary/40 text-primary",
              )}
            >
              {ep.method}
            </Badge>
            <code className="truncate text-xs text-foreground">{ep.path}</code>
          </div>
          <div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-xs text-muted-foreground">{ep.description}</p>
            <Badge
              variant="outline"
              className={cn("shrink-0 text-[10px]", STATUS_META[ep.status].className)}
            >
              {STATUS_META[ep.status].label}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CapabilitySection({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="card-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon className="size-4 text-primary" aria-hidden />
            {title}
          </CardTitle>
          {badge && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {badge}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
